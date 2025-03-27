import cv2
import torch
from ultralytics import YOLO
import time
import os

# Load your trained YOLOv8 model
model = YOLO("best.pt")

# Open the webcam (0 is default camera)
cap = cv2.VideoCapture(0)

# Ensure output folder exists
output_folder = "detected_bottles"
os.makedirs(output_folder, exist_ok=True)

frame_count = 0  # To limit saved images
while cap.isOpened():
    success, frame = cap.read()
    if not success:
        print("Failed to grab frame.")
        break

    # Run YOLOv8 model on the frame
    results = model(frame)

    # Draw bounding boxes
    for result in results:
        for box in result.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0])  # Bounding box coordinates
            conf = box.conf[0].item()  # Confidence score
            cls = int(box.cls[0].item())  # Class index

            # Only save images if detected class is "bottle"
            if cls == 0 and conf > 0.5:  # Adjust class ID and confidence if needed
                label = f"Plastic Bottle ({conf:.2f})"
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.putText(frame, label, (x1, y1 - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

                # Save frame with detected bottle
                img_path = os.path.join(output_folder, f"bottle_{frame_count}.jpg")
                cv2.imwrite(img_path, frame)
                print(f"Image saved: {img_path}")
                frame_count += 1

    # Display the frame
    cv2.imshow("YOLOv8 Detection", frame)

    # Exit when 'q' is pressed
    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

# Cleanup
cap.release()
cv2.destroyAllWindows()
