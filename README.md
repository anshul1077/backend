# Zump Backend

This project is the backend API for the Zump application. It is built with Node.js, Express, MongoDB, Redis, and Cloudinary.

## Project Structure

```text
zump/
├── backend/
│   ├── config/
│   │   ├── firebase.js
│   │   ├── redis.js
│   │   └── serviceAccountKey.json
│   ├── controllers/
│   │   └── userController.js
│   ├── models/
│   │   ├── authActivities.js
│   │   ├── session.js
│   │   └── user.js
│   ├── routes/
│   │   └── userRouter.js
│   ├── services/
│   │   └── userService.js
│   ├── server.js
│   ├── package.json
│   └── .env
├── README.md
└── package.json (if added later)
```

## Main Features

- User signup and login
- OTP request and verification
- JWT access token / refresh token flow
- Session handling
- MongoDB user and activity management
- Redis-based OTP cooldown and verification storage
- Cloudinary image upload for profile avatars

## Setup

1. Open the backend folder:

```bash
cd backend
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file with values such as:

```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/zump
SESSION_SECRET=your_session_secret
ACCESS_TOKEN_SECRET=your_access_token_secret
REFRESH_TOKEN_SECRET=your_refresh_token_secret
ACCESS_TOKEN_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
REDIS_HOST=localhost
REDIS_PORT=6379
```

4. Start the server:

```bash
npm start
```

## Request Flow

The application follows a clean flow:

1. Request enters the Express app in `server.js`
2. Route is matched in `routes/userRouter.js`
3. Validation is done using Joi in the route layer
4. The route calls the controller in `controllers/userController.js`
5. The controller delegates business logic to the service in `services/userService.js`
6. The service talks to:
   - MongoDB models
   - Redis for OTP storage
   - Cloudinary for image upload
7. Response is sent back to the client

## Example Workflow

### 1. User Signup Flow

```text
Client -> POST /api/v1/users
    -> route validates body
    -> controller calls signup service
    -> service checks if user exists
    -> service hashes password
    -> service uploads avatar if image exists
    -> service creates user in MongoDB
    -> API returns success response
```

### 2. Login Flow

```text
Client -> POST /api/v1/auth/login
    -> route validates email/password
    -> controller calls login service
    -> service checks user and password
    -> service verifies account is OTP-verified
    -> service creates JWT tokens
    -> service saves session info
    -> API returns accessToken and user data
```

### 3. OTP Flow

```text
Client -> POST /api/v1/auth/otp/request
    -> route validates phone number
    -> service checks Redis cooldown
    -> service generates OTP and stores hash in Redis
    -> client receives OTP response

Client -> POST /api/v1/auth/otp/verify
    -> route validates phone + OTP
    -> service checks OTP hash in Redis
    -> service validates attempt count
    -> service marks user as verified
    -> service creates access token + refresh token
    -> API returns login success response
```

### 4. Refresh Token Flow

```text
Client -> POST /api/v1/auth/refresh
    -> server reads refreshToken from cookie
    -> service verifies token
    -> service checks if user still exists
    -> service creates a new access token and refresh token
    -> client receives refreshed token
```

### 5. Logout Flow

```text
Client -> POST /api/v1/auth/logout
    -> controller calls logout service
    -> service clears session and user sessions
    -> service logs logout activity
    -> refresh token cookie is cleared
    -> success response returned
```

## Important Notes

- Route files handle request validation.
- Controller files handle HTTP logic and response formatting.
- Service files handle all core logic and database operations.
- Models represent MongoDB data structures.
- Redis is used for OTP storage, cooldowns, and quick validation.

## Common Commands

```bash
cd backend
npm install
npm start
```

## Future Improvements

- Add centralized error handling middleware
- Move validation logic into separate validators
- Add request logging and monitoring
- Add unit and integration tests
- Separate authentication logic into a dedicated auth module
