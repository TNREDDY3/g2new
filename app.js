const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
const User = require('./models/User');
const dotenv = require('dotenv');
const fs = require('fs');
const { spawn } = require('child_process');

// Load environment variables
dotenv.config();

// Check if bg.png exists and move it to public/images
try {
    if (fs.existsSync('./bg.png')) {
        // Create directory if it doesn't exist
        if (!fs.existsSync('./public/images')) {
            fs.mkdirSync('./public/images', { recursive: true });
        }
        // Copy the file
        fs.copyFileSync('./bg.png', './public/images/bg.png');
        console.log('Background image copied to public/images directory');
    }
} catch (err) {
    console.error('Error handling background image:', err);
}

// Create Express app
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Update MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    family: 4
})
.then(() => console.log('MongoDB connected successfully'))
.catch(err => console.error('MongoDB connection error:', err));

// Set up EJS as the view engine
app.set('view engine', 'ejs');

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Parse JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => {
    res.render('index');
});

// Secret registration route
app.get('/sec-reg', (req, res) => {
    res.render('register');
});

// Add admin route
app.get('/admin', (req, res) => {
    res.render('admin');
});

// 404 route
app.use((req, res) => {
    res.status(404).send('404 - Page Not Found');
});

// Socket.IO connection
io.on('connection', (socket) => {
    console.log('New client connected');
    
    // Handle scanner open event
    socket.on('scannerOpen', () => {
        // Broadcast to all admin clients
        io.emit('scannerOpen');
    });

    // Handle registration
    socket.on('register', async (data) => {
        try {
            // Check if user ID already exists
            const existingUser = await User.findOne({ userId: data.userId });
            if (existingUser) {
                return socket.emit('registrationFailed', 'User ID already exists');
            }
            
            // Create new user
            const newUser = new User({
                fullName: data.fullName,
                userId: data.userId,
                password: data.password
            });
            
            // Save user to database
            await newUser.save();
            
            socket.emit('registrationSuccess');
        } catch (error) {
            console.error('Registration error:', error);
            socket.emit('registrationFailed', 'Registration failed. Please try again.');
        }
    });
    
    // Handle login
    socket.on('login', async (data) => {
        try {
            // Find user by userId
            const user = await User.findOne({ userId: data.userId });
            if (!user) {
                return socket.emit('loginFailed', 'Invalid User ID or password');
            }
            
            // Check password
            const isMatch = await user.comparePassword(data.password);
            if (!isMatch) {
                return socket.emit('loginFailed', 'Invalid User ID or password');
            }
            
            // Store user data in socket session
            socket.userData = {
                userId: user.userId,
                name: user.fullName,
                bottleCount: user.bottleCount
            };
            
            // Send success response
            socket.emit('loginSuccess', {
                userId: user.userId,
                name: user.fullName,
                bottleCount: user.bottleCount
            });
        } catch (error) {
            console.error('Login error:', error);
            socket.emit('loginFailed', 'Login failed. Please try again.');
        }
    });

    // Handle bottle scanning
    socket.on('scanFrame', async (imageData) => {
        try {
            // Get the absolute path to the Python script
            const scriptPath = path.join(__dirname, 'ml_model', 'bottle_detector.py');
            
            // Validate image data
            if (!imageData || typeof imageData !== 'string') {
                throw new Error('Invalid image data received');
            }

            // Create temp directory if it doesn't exist
            const tempDir = path.join(__dirname, 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir);
            }

            // Create unique temp file name
            const timestamp = Date.now();
            const tempFile = path.join(tempDir, `frame_${timestamp}.txt`);

            try {
                // Write image data to temp file
                fs.writeFileSync(tempFile, imageData);

                // Set up Python process
                const pythonProcess = spawn('python', [scriptPath, tempFile], {
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                let stdoutData = '';
                let stderrData = '';

                // Handle stdout data
                pythonProcess.stdout.on('data', (data) => {
                    const lines = data.toString().split('\n');
                    lines.forEach(line => {
                        if (line.trim()) {
                            try {
                                const jsonData = JSON.parse(line);
                                if (jsonData.status) {
                                    console.log('Python status:', jsonData.status);
                                } else if (!jsonData.error) {
                                    stdoutData = line;
                                }
                            } catch (e) {
                                console.log('Raw output:', line);
                            }
                        }
                    });
                });

                // Handle stderr data
                pythonProcess.stderr.on('data', (data) => {
                    const lines = data.toString().split('\n');
                    lines.forEach(line => {
                        if (line.trim()) {
                            try {
                                const jsonData = JSON.parse(line);
                                if (jsonData.error) {
                                    stderrData = jsonData.error;
                                    if (jsonData.traceback) {
                                        console.error('Python error traceback:', jsonData.traceback);
                                    }
                                }
                            } catch (e) {
                                stderrData += line + '\n';
                            }
                        }
                    });
                });

                // Handle process completion
                pythonProcess.on('close', (code) => {
                    try {
                        // Clean up temp file
                        if (fs.existsSync(tempFile)) {
                            fs.unlinkSync(tempFile);
                        }

                        if (code !== 0) {
                            console.error('Python process error:', stderrData);
                            throw new Error(stderrData || 'Detection process failed');
                        }

                        // Parse and validate the result
                        const result = JSON.parse(stdoutData.trim());
                        if (!result || typeof result !== 'object') {
                            throw new Error('Invalid detection result format');
                        }

                        // Emit deposit attempt to admin portal
                        io.emit('depositAttempt', {
                            is_bottle: result.is_bottle,
                            timestamp: new Date().toISOString()
                        });

                        // Update user's bottle count if bottle detected
                        if (result.is_bottle && socket.userData && socket.userData.userId) {
                            User.findOneAndUpdate(
                                { userId: socket.userData.userId },
                                { $inc: { bottleCount: 1 } }
                            ).exec();
                        }

                        // Log detection results
                        console.log('Detection result:', {
                            is_bottle: result.is_bottle,
                            confidence: result.confidence,
                            num_detections: result.detections.length
                        });

                        // Emit result to client
                        socket.emit('detectionResult', {
                            ...result,
                            error: null
                        });
                    } catch (error) {
                        console.error('Error processing detection result:', error);
                        socket.emit('detectionResult', {
                            error: error.message || 'Failed to process detection result',
                            is_bottle: false,
                            confidence: 0,
                            detections: []
                        });
                    }
                });

                // Handle process error
                pythonProcess.on('error', (error) => {
                    console.error('Python process error:', error);
                    if (fs.existsSync(tempFile)) {
                        fs.unlinkSync(tempFile);
                    }
                    socket.emit('detectionResult', {
                        error: 'Failed to start detection process',
                        is_bottle: false,
                        confidence: 0,
                        detections: []
                    });
                });

            } catch (error) {
                // Clean up temp file if it exists
                if (fs.existsSync(tempFile)) {
                    fs.unlinkSync(tempFile);
                }
                throw error;
            }
        } catch (error) {
            console.error('Error processing detection:', error);
            socket.emit('detectionResult', {
                error: 'Failed to process image',
                is_bottle: false,
                confidence: 0,
                detections: []
            });
        }
    });
    
    // Handle bottle count retrieval
    socket.on('getBottleCount', async (data) => {
        try {
            const user = await User.findOne({ userId: data.userId });
            if (user) {
                socket.emit('bottleCount', { count: user.bottleCount });
            }
        } catch (error) {
            console.error('Get bottle count error:', error);
        }
    });
    
    // Handle logout
    socket.on('logout', () => {
        // Clear user data from socket
        socket.userData = null;
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 