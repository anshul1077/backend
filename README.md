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
- Direct Cloudinary image uploads for profile avatars

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
PORT=9000
MONGO_URI=mongodb://localhost:27017/zump
SESSION_SECRET=your_session_secret
ACCESS_TOKEN_SECRET=your_access_token_secret
REFRESH_TOKEN_SECRET=your_refresh_token_secret
ACCESS_TOKEN_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
CLOUDINARY_AUTH_TOKEN_KEY=your_cloudinary_auth_token_key
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

## Signup Avatar Flow

Do not send a base64 `image` field to `POST /api/v1/users`. The API does not
proxy avatar files. Use these requests instead:

1. Call `POST /api/v1/users/avatar/upload`.
2. Submit the returned `fields` and the image file directly to the returned
    Cloudinary `uploadUrl` as multipart form data.
3. Call `POST /api/v1/users` with the normal signup JSON plus the returned
    `avatarUploadId`:

```json
{
  "name": "arya",
  "email": "arya@example.com",
  "password": "aryaa@123",
  "address": "mohali, punjab",
  "phone": "8219442189",
  "countryCode": "+91",
  "dateOfBirth": "2002-02-01",
  "avatarUploadId": "UPLOAD_ID_FROM_STEP_1"
}
```

The server verifies that the Cloudinary object exists, is an authenticated
JPEG/PNG/WebP image no larger than 5 MB, and only then attaches it to the new
user. Use Postman `form-data` only for the direct Cloudinary request, not for
the API signup request.

## Signup Phone and OTP Storage

After a successful signup, Redis stores one JSON record for the user:

```text
signup:user:<USER_ID>
```

Example value:

```json
{
    "userId": "...",
    "phone": "9876543210",
    "otpHash": "...",
    "otpExpiresAt": "2026-09-25T16:00:00.000Z",
    "attempts": 0,
    "isVerified": false
}
```

Redis also stores `signup:phone:<PHONE>` as a lookup to the user ID. The OTP
is stored as a SHA-256 hash, never as plaintext. OTP metadata expires after
five minutes, failed attempts are limited to five, and successful verification
clears the hash and sets `isVerified` to `true`. Search for `signup:user:*` in
RedisInsight to inspect these records.

## Avatar Upload Flow

Avatar files are not sent through this API. Cloudinary does not issue S3-style
presigned `PUT` URLs; its equivalent is a short-lived, server-signed direct
upload contract. The client uses this flow:

1. Call `POST /api/v1/users/me/avatar/upload` with the access token.
2. Send the returned `fields` and the selected file directly to the returned
    Cloudinary `uploadUrl` as a multipart form upload. Do not send the file to
    the Zump API.
3. Call `POST /api/v1/users/me/avatar/confirm` with the returned `uploadId`.
4. The server fetches the Cloudinary resource metadata and verifies that it is
    an image, is JPEG/PNG/WebP, and is no larger than 5 MB.
5. Only after verification does the server attach the URL and public ID to the
    user, invalidate the Redis profile cache, and delete the previously attached
    Cloudinary object.

Profile responses return `avatarUrl`, a Cloudinary authenticated delivery URL
that expires after five minutes. The API never returns a permanent Cloudinary
URL or the internal public ID. Redis regenerates this signed URL on every read,
so a longer Redis profile-cache lifetime cannot make the delivery URL stale.
Set `CLOUDINARY_AUTH_TOKEN_KEY` to the hex key configured for authenticated
delivery in Cloudinary; it is separate from the API secret.

Direct upload matters because large binary files do not consume API server
memory, bandwidth, or request time. The confirmation step matters because a
client-provided URL or filename is not proof that the uploaded object exists
or has an allowed type and size. The server must verify the object before
attaching it to a user.

The old profile update routes no longer accept base64 avatar data. Use the two
avatar endpoints above instead.

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
