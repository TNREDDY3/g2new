document.addEventListener("DOMContentLoaded", function () {
    const eyeIcon = document.querySelector(".eye-icon");
    const passwordInput = document.getElementById("password");
    const loginButton = document.querySelector(".login-btn");
    const endButton = document.querySelector(".End-btn");
    const depositButton = document.querySelector(".deposit-btn");
    const loginSection = document.getElementById("login-section");
    const depositSection = document.getElementById("deposit-section");
    const depositScreen = document.getElementById("deposit-screen");
    const bottleDetectedScreen = document.getElementById("bottle-detected-screen");
    const patienceScreen = document.getElementById("patience-screen");
    const foreignItemScreen = document.getElementById("foreign-item-screen");
    const countBox = document.querySelector(".count-box");
    const bottleDetectedBtn = document.getElementById("bottle-detected-btn");
    const foreignItemBtn = document.getElementById("foreign-item-btn");
    const userIdInput = document.getElementById("user-id");
    const errorMessage = document.querySelector(".error-message");
    
    // Connect to Socket.IO
    const socket = io();
    
    let count = 0;

    // Toggle password visibility
    if (eyeIcon) {
        eyeIcon.addEventListener("click", function () {
            passwordInput.type = passwordInput.type === "password" ? "text" : "password";
            eyeIcon.classList.toggle("fa-eye");
            eyeIcon.classList.toggle("fa-eye-slash");
        });
    }

    // Handle login
    if (loginButton) {
        loginButton.addEventListener("click", function () {
            const userId = userIdInput.value.trim();
            const password = passwordInput.value.trim();
            
            if (userId && password) {
                // Emit login event to server
                socket.emit('login', { userId, password });
            } else {
                // Display error if fields are empty
                if (!document.querySelector(".error-message")) {
                    const error = document.createElement("div");
                    error.className = "error-message";
                    error.textContent = "Please fill in all fields";
                    loginButton.insertAdjacentElement('afterend', error);
                }
            }
        });
    }
    
    // Socket event handlers
    socket.on('loginSuccess', function(userData) {
        // Update user info in deposit section
        if (document.querySelector(".user-name")) {
            document.querySelector(".user-name").textContent = userData.name;
        }
        if (document.querySelector(".user-id")) {
            document.querySelector(".user-id").textContent = "User ID: " + userData.userId;
        }
        
        // Update timestamp
        if (document.querySelector(".timestamp")) {
            const now = new Date();
            document.querySelector(".timestamp").textContent = "Date-Time: " + now.toISOString().replace('T', ' ').substring(0, 19);
        }
        
        // Show deposit section
        loginSection.style.display = "none";
        depositSection.style.display = "block";
        
        // Get bottle count from server
        socket.emit('getBottleCount', { userId: userData.userId });
    });
    
    socket.on('loginFailed', function(msg) {
        // Display error message
        if (!document.querySelector(".error-message")) {
            const error = document.createElement("div");
            error.className = "error-message";
            error.textContent = msg;
            loginButton.insertAdjacentElement('afterend', error);
        } else {
            document.querySelector(".error-message").textContent = msg;
        }
    });
    
    socket.on('bottleCount', function(data) {
        count = data.count;
        countBox.innerText = count;
    });
    
    socket.on('bottleAdded', function(data) {
        count = data.count;
        countBox.innerText = count;
    });

    // Handle End (logout) button
    if (endButton) {
        endButton.addEventListener("click", function () {
            depositSection.style.display = "none";
            loginSection.style.display = "flex";
            
            // Clear form fields
            if (userIdInput) userIdInput.value = "";
            if (passwordInput) passwordInput.value = "";
            
            // Remove any error messages
            const errorMsg = document.querySelector(".error-message");
            if (errorMsg) errorMsg.remove();
            
            // Emit logout event
            socket.emit('logout');
        });
    }

    // Handle Deposit button click
    if (depositButton) {
        depositButton.addEventListener("click", function() {
            depositSection.style.display = "none";
            depositScreen.style.display = "flex";
            bottleDetectedBtn.style.display = "inline-block";
            foreignItemBtn.style.display = "inline-block";
        });
    }

    // Handle Bottle Detected
    if (bottleDetectedBtn) {
        bottleDetectedBtn.addEventListener("click", function() {
            depositScreen.style.display = "none";
            bottleDetectedScreen.style.display = "flex";
            
            setTimeout(() => {
                bottleDetectedScreen.style.display = "none";
                patienceScreen.style.display = "flex"; // Show patience message

                setTimeout(() => {
                    // Emit bottle detected event
                    socket.emit('bottleDeposited');
                    
                    patienceScreen.style.display = "none";
                    depositSection.style.display = "block";
                }, 2000);
            }, 2000);
        });
    }

    // Handle Foreign Item Detected
    if (foreignItemBtn) {
        foreignItemBtn.addEventListener("click", function() {
            depositScreen.style.display = "none";
            foreignItemScreen.style.display = "flex";
            
            setTimeout(() => {
                foreignItemScreen.style.display = "none";
                depositSection.style.display = "block";
            }, 2000);
        });
    }
});

// Prevent F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U (view source)
document.addEventListener("keydown", function (event) {
    if (event.key === "F12" || 
        (event.ctrlKey && event.shiftKey && (event.key === "I" || event.key === "J")) || 
        (event.ctrlKey && event.key === "U")) {
        event.preventDefault();
    }
});

// Prevent right-click
document.addEventListener("contextmenu", function (event) {
    event.preventDefault();
}); 