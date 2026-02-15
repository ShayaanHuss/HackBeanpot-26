import React, { useRef, useState, useEffect, useCallback } from 'react';
import RayTracedMirror from './RayTracedMirror';

// Convert MirrorCurveDesigner data to RayTracedMirror format
const convertCurveDataToSegments = (curveData) => {
  console.log('[convertCurveDataToSegments] Input curveData:', curveData);
  
  if (!curveData || !curveData.lineSegments || curveData.lineSegments.length === 0) {
    // Default to a flat mirror - normalized coordinates
    const defaultSegment = [{
      yMin: -0.4,  // Physical coordinates matching mirrorHalfHeight
      yMax: 0.4,
      z0: 0.0,     // At the mirror plane
      z1: 0.0,
      z2: 0.0
    }];
    console.log('[convertCurveDataToSegments] Using default flat mirror:', defaultSegment);
    return defaultSegment;
  }

  // Get bounds from curve data
  const bounds = curveData.bounds;
  const canvasHeight = bounds.yBottom - bounds.yTop;  // e.g., 550 - 50 = 500
  const canvasWidth = bounds.x;  // e.g., 400 (the centerline x position)
  
  // Physical dimensions for the shader (matching the mirror parameters)
  const physicalHalfHeight = 2.0;  // Make mirror much taller
  const physicalMaxDepth = 1.0;    // Increase max curve depth
  
  console.log('[convertCurveDataToSegments] Canvas bounds:', { 
    yTop: bounds.yTop, 
    yBottom: bounds.yBottom, 
    x: bounds.x,
    canvasHeight 
  });

  // Convert line segments to Bezier curve segments with coordinate transformation
  const result = curveData.lineSegments.map(seg => {
    // Convert y coordinates from canvas pixels to physical coordinates [-0.4, 0.4]
    const y1Physical = ((seg.y1 - bounds.yTop) / canvasHeight) * (2 * physicalHalfHeight) - physicalHalfHeight;
    const y2Physical = ((seg.y2 - bounds.yTop) / canvasHeight) * (2 * physicalHalfHeight) - physicalHalfHeight;
    
    const yMin = Math.min(y1Physical, y2Physical);
    const yMax = Math.max(y1Physical, y2Physical);
    
    // Convert x coordinates from canvas pixels to physical depth
    // Pixels to the left of centerline (x < bounds.x) represent curve toward viewer (negative z)
    // Negate so curves toward viewer are negative (closer to camera)
    const x1Depth = -((bounds.x - seg.x1) / canvasWidth * physicalMaxDepth);
    const x2Depth = -((bounds.x - seg.x2) / canvasWidth * physicalMaxDepth);
    
    let z0, z2;
    // Handle orientation: ensure z0 corresponds to yMin and z2 to yMax
    if (y1Physical <= y2Physical) {
      z0 = x1Depth;
      z2 = x2Depth;
    } else {
      z0 = x2Depth;
      z2 = x1Depth;
    }
    
    // For linear segment, control point is the midpoint
    const z1 = (z0 + z2) / 2;
    
    return { yMin, yMax, z0, z1, z2 };
  });
  
  console.log('[convertCurveDataToSegments] Converted', result.length, 'segments to physical coordinates:', result);
  return result;
};

export default function FunhouseMirrorWebcam({ curveData }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isActive, setIsActive] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [useRayTracing, setUseRayTracing] = useState(false);
  const animationIdRef = useRef(null);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 640, height: 480 } 
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play().then(() => {
            setIsActive(true);
          });
        };
      }
    } catch (err) {
      console.error('Camera error:', err);
      let errorMessage = 'Camera error: ';
      
      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMessage += 'No camera found. Please connect a camera and try again.';
      } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage += 'Camera access denied. Please allow camera permissions in your browser settings.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorMessage += 'Camera is already in use by another application. Please close other apps using the camera.';
      } else {
        errorMessage += err.message;
      }
      
      alert(errorMessage);
    }
  };

  const stopCamera = () => {
    const stream = videoRef.current?.srcObject;
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    
    if (animationIdRef.current) {
      cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
    }
    
    setIsActive(false);
  };

  const rotateDistortion = () => {
    setRotation(prev => (prev + 90) % 360);
  };
  
  const toggleRayTracing = () => {
    console.log('[FunhouseMirrorWebcam] Toggling ray tracing from', useRayTracing, 'to', !useRayTracing);
    console.log('[FunhouseMirrorWebcam] Video element:', videoRef.current);
    console.log('[FunhouseMirrorWebcam] Video ready state:', videoRef.current?.readyState);
    console.log('[FunhouseMirrorWebcam] Video dimensions:', videoRef.current?.videoWidth, 'x', videoRef.current?.videoHeight);
    setUseRayTracing(!useRayTracing);
  };
  
  // Log when ray tracing mode changes
  useEffect(() => {
    console.log('[FunhouseMirrorWebcam] Ray tracing mode is now:', useRayTracing);
  }, [useRayTracing]);
  
  const applyDistortion = useCallback((ctx, video, curve, rot) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    
    ctx.drawImage(video, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const outputData = ctx.createImageData(w, h);
    
    const bounds = curve.bounds;
    const yRange = bounds.yBottom - bounds.yTop;
    const xRange = bounds.x;
    
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sourceX = x;
        let sourceY = y;
        
        if (rot === 0) {
          const curveY = bounds.yTop + (y / h) * yRange;
          let curveX = bounds.x;
          
          for (const seg of curve.lineSegments) {
            const minY = Math.min(seg.y1, seg.y2);
            const maxY = Math.max(seg.y1, seg.y2);
            
            if (curveY >= minY && curveY <= maxY) {
              const t = (curveY - seg.y1) / (seg.y2 - seg.y1 || 1);
              curveX = seg.x1 + t * (seg.x2 - seg.x1);
              break;
            }
          }
          
          const offset = (bounds.x - curveX) / xRange;
          const disp = offset * w * 0.5;
          sourceX = Math.floor(x - disp);
          
        } else if (rot === 90) {
          const curveY = bounds.yTop + (x / w) * yRange;
          let curveX = bounds.x;
          
          for (const seg of curve.lineSegments) {
            const minY = Math.min(seg.y1, seg.y2);
            const maxY = Math.max(seg.y1, seg.y2);
            
            if (curveY >= minY && curveY <= maxY) {
              const t = (curveY - seg.y1) / (seg.y2 - seg.y1 || 1);
              curveX = seg.x1 + t * (seg.x2 - seg.x1);
              break;
            }
          }
          
          const offset = (bounds.x - curveX) / xRange;
          const disp = offset * h * 0.5;
          sourceY = Math.floor(y - disp);
          
        } else if (rot === 180) {
          const curveY = bounds.yTop + ((h - y) / h) * yRange;
          let curveX = bounds.x;
          
          for (const seg of curve.lineSegments) {
            const minY = Math.min(seg.y1, seg.y2);
            const maxY = Math.max(seg.y1, seg.y2);
            
            if (curveY >= minY && curveY <= maxY) {
              const t = (curveY - seg.y1) / (seg.y2 - seg.y1 || 1);
              curveX = seg.x1 + t * (seg.x2 - seg.x1);
              break;
            }
          }
          
          const offset = (bounds.x - curveX) / xRange;
          const disp = offset * w * 0.5;
          sourceX = Math.floor(x + disp);
          
        } else if (rot === 270) {
          const curveY = bounds.yTop + ((w - x) / w) * yRange;
          let curveX = bounds.x;
          
          for (const seg of curve.lineSegments) {
            const minY = Math.min(seg.y1, seg.y2);
            const maxY = Math.max(seg.y1, seg.y2);
            
            if (curveY >= minY && curveY <= maxY) {
              const t = (curveY - seg.y1) / (seg.y2 - seg.y1 || 1);
              curveX = seg.x1 + t * (seg.x2 - seg.x1);
              break;
            }
          }
          
          const offset = (bounds.x - curveX) / xRange;
          const disp = offset * h * 0.5;
          sourceY = Math.floor(y + disp);
        }
        
        if (sourceX >= 0 && sourceX < w && sourceY >= 0 && sourceY < h) {
          const sourceIdx = (sourceY * w + sourceX) * 4;
          const targetIdx = (y * w + x) * 4;
          
          outputData.data[targetIdx] = imageData.data[sourceIdx];
          outputData.data[targetIdx + 1] = imageData.data[sourceIdx + 1];
          outputData.data[targetIdx + 2] = imageData.data[sourceIdx + 2];
          outputData.data[targetIdx + 3] = imageData.data[sourceIdx + 3];
        }
      }
    }
    
    ctx.putImageData(outputData, 0, 0);
  }, []);

  useEffect(() => {
    if (!isActive) {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
        animationIdRef.current = null;
      }
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    
    const render = () => {
      if (!isActive || !video || video.readyState < video.HAVE_CURRENT_DATA) {
        animationIdRef.current = requestAnimationFrame(render);
        return;
      }

      if (video.videoWidth > 0 && video.videoHeight > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        const hasCurve = curveData && curveData.lineSegments && curveData.lineSegments.length > 0;
        
        if (!hasCurve) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        } else {
          applyDistortion(ctx, video, curveData, rotation);
        }
      }
      
      animationIdRef.current = requestAnimationFrame(render);
    };
    
    render();
    
    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
        animationIdRef.current = null;
      }
    };
  }, [isActive, curveData, rotation, applyDistortion]);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-4">
      <video ref={videoRef} autoPlay playsInline muted style={{display: 'none'}} />
      
      {useRayTracing ? (
        <RayTracedMirror
          videoRef={videoRef}
          curveSegments={convertCurveDataToSegments(curveData)}
          mirrorDist={3.5}
          mirrorHalfWidth={2.0}
          mirrorHalfHeight={2.0}
          imagePlaneDist={1.0}
          imageSizeX={1.6}
          imageSizeY={1.2}
          fov={60.0}
          width={640}
          height={480}
        />
      ) : (
        <canvas 
          ref={canvasRef} 
          width="640" 
          height="480" 
          className="w-full h-auto max-h-full object-contain rounded-lg"
        />
      )}
      
      <div className="flex gap-3 mt-4">
        <button 
          onClick={startCamera} 
          disabled={isActive}
          className="px-6 py-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-bold rounded-lg shadow-lg transition-colors"
        >
          Start Camera
        </button>
        <button 
          onClick={stopCamera} 
          disabled={!isActive}
          className="px-6 py-2 bg-red-500 hover:bg-red-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-bold rounded-lg shadow-lg transition-colors"
        >
          Stop Camera
        </button>
        <button 
          onClick={rotateDistortion} 
          disabled={!curveData || useRayTracing}
          className="px-6 py-2 bg-purple-500 hover:bg-purple-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-bold rounded-lg shadow-lg transition-colors"
        >
          Rotate 90°
        </button>
        <button 
          onClick={toggleRayTracing} 
          disabled={!isActive}
          className="px-6 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-bold rounded-lg shadow-lg transition-colors"
        >
          {useRayTracing ? 'Classic Mode' : 'Ray Traced'}
        </button>
      </div>
      
      <p className="mt-3 text-sm text-gray-300">
        Status: <span className="font-semibold">{isActive ? 'Active' : 'Stopped'}</span> | 
        Curve: <span className="font-semibold">{curveData ? 'Loaded' : 'None'}</span> | 
        Rotation: <span className="font-semibold">{rotation}°</span> | 
        Mode: <span className="font-semibold">{useRayTracing ? 'Ray Traced' : 'Classic'}</span>
      </p>
    </div>
  );
}