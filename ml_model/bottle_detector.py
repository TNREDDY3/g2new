import os
import sys
import json
import base64
import torch
import numpy as np
from PIL import Image
import io
import cv2
import traceback
from ultralytics import YOLO

# Define valid container classes
VALID_CONTAINERS = {'plastic', 'glass-bottle', 'metal-can'}

class BottleDetector:
    def __init__(self):
        try:
            # Get the absolute path to the model file
            current_dir = os.path.dirname(os.path.abspath(__file__))
            self.model_path = os.path.join(current_dir, 'best.pt')
            
            if not os.path.exists(self.model_path):
                raise FileNotFoundError(f"Model file not found at {self.model_path}")

            # Set up CUDA if available
            self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
            print(json.dumps({"status": f"Using device: {self.device}"}))

            # Load YOLO model with error handling
            try:
                print(json.dumps({"status": "Loading YOLOv5 model..."}))
                self.model = YOLO(self.model_path)  # Load the model directly
                
                # Verify model classes
                if not hasattr(self.model, 'names'):
                    raise ValueError("Model loaded but no class names found")
                
                # Print available classes
                print(json.dumps({
                    "status": "Available classes",
                    "classes": self.model.names
                }))
                
                print(json.dumps({"status": "Model loaded successfully"}))
            except Exception as model_error:
                print(json.dumps({"error": f"Failed to load model: {str(model_error)}"}))
                raise

            # Configure model settings for better detection
            self.model.conf = 0.35  # Lower confidence threshold for better detection
            self.model.iou = 0.45   # NMS IoU threshold
            self.model.max_det = 5   # Maximum detections per image
            self.model.to(self.device)

            print(json.dumps({
                "status": "Model initialized successfully",
                "classes": self.model.names,
                "settings": {
                    "confidence_threshold": self.model.conf,
                    "iou_threshold": self.model.iou,
                    "max_detections": self.model.max_det
                }
            }))

        except Exception as e:
            error_trace = traceback.format_exc()
            print(json.dumps({
                "error": f"Model initialization failed: {str(e)}",
                "traceback": error_trace,
                "is_bottle": False,
                "confidence": 0,
                "detections": []
            }), file=sys.stderr)
            sys.exit(1)

    def preprocess_image(self, image_data):
        try:
            # Remove the data URL prefix if present
            if ',' in image_data:
                image_data = image_data.split(',')[1]
            
            # Decode base64 image
            image_bytes = base64.b64decode(image_data)
            nparr = np.frombuffer(image_bytes, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if image is None:
                raise Exception("Failed to decode image")

            # Convert BGR to RGB
            image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

            # Get image dimensions
            height, width = image.shape[:2]
            print(json.dumps({
                "status": f"Image preprocessed successfully: {width}x{height}"
            }))
            
            return image
            
        except Exception as e:
            error_trace = traceback.format_exc()
            print(json.dumps({
                "error": f"Image preprocessing failed: {str(e)}",
                "traceback": error_trace
            }), file=sys.stderr)
            raise

    def detect_bottle(self, image):
        try:
            # Run inference with augmentation for better detection
            results = self.model.predict(
                image,
                conf=self.model.conf,
                iou=self.model.iou,
                augment=True,  # Enable test time augmentation
                verbose=False
            )
            result = results[0]  # Get the first result
            
            # Process results
            detections = []
            max_confidence = 0
            is_bottle = False
            detected_classes = set()
            
            if len(result.boxes) > 0:
                # Sort boxes by confidence
                boxes = result.boxes
                confidences = boxes.conf.cpu().numpy()
                sorted_indices = np.argsort(-confidences)  # Sort in descending order
                
                # Process each detection
                for idx in sorted_indices:
                    box = boxes[idx]
                    confidence = float(box.conf[0])
                    
                    if confidence > self.model.conf:
                        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                        cls_id = int(box.cls[0])
                        label = result.names[cls_id].lower()
                        
                        # Update max confidence
                        if confidence > max_confidence:
                            max_confidence = confidence
                        
                        # Create detection object with additional info
                        detection = {
                            "x": x1,
                            "y": y1,
                            "width": int(x2 - x1),
                            "height": int(y2 - y1),
                            "confidence": confidence,
                            "label": label,
                            "class_id": cls_id
                        }
                        
                        detections.append(detection)
                        detected_classes.add(label)
                        
                        # Check if the detected object is a valid container
                        if label in VALID_CONTAINERS:
                            is_bottle = True
            
            result_dict = {
                "is_bottle": is_bottle,
                "confidence": float(max_confidence),
                "detections": detections,
                "num_detections": len(detections),
                "detected_classes": list(detected_classes)
            }
            
            print(json.dumps({
                "status": "Detection completed successfully",
                "result": result_dict
            }))
            
            return result_dict
            
        except Exception as e:
            error_trace = traceback.format_exc()
            print(json.dumps({
                "error": f"Detection failed: {str(e)}",
                "traceback": error_trace
            }), file=sys.stderr)
            raise

def main():
    try:
        # Get image data from command line argument
        if len(sys.argv) < 2:
            raise Exception("No image data provided")
        
        # Read image data from temporary file
        with open(sys.argv[1], 'r') as f:
            image_data = f.read()
        
        print(json.dumps({"status": "Starting bottle detection..."}))
        
        # Initialize detector
        detector = BottleDetector()
        
        # Process image
        image = detector.preprocess_image(image_data)
        
        # Run detection
        result = detector.detect_bottle(image)
        
        # Return result as JSON
        print(json.dumps(result))
        
    except Exception as e:
        error_trace = traceback.format_exc()
        print(json.dumps({
            "error": str(e),
            "traceback": error_trace,
            "is_bottle": False,
            "confidence": 0,
            "detections": []
        }), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main() 