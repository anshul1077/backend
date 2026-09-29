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
- Redis cache-aside profile reads with a 300-second default TTL

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
    -> Joi validates the complete required payload before service/database work
    -> service hashes password
    -> MongoDB transaction creates user and signup activity together
    -> API returns 201 with the user resource and no password hash
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
    -> service generates OTP and stores only its hash in Redis for five minutes
    -> service enforces a 30-second resend cooldown and five verification attempts
    -> an SMS provider must deliver the OTP; the API does not return the secret

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
    -> service revokes the current refresh-token session
    -> service logs logout activity
    -> service invalidates the user's profile cache
    -> refresh token cookie is cleared
    -> success response returned
```

## Important Notes

When `NODE_ENV` is not `production`, the OTP request response includes the
six-digit `otp` and `expiresInSeconds` for Postman/local testing. Production
responses never include the OTP; connect an SMS provider to deliver it there.

## Consistency And Profile Semantics

Signup writes the user and its `signup` activity record in one MongoDB
transaction. This requires MongoDB to run as a replica set (including a
single-node replica set for local development). Redis signup/OTP metadata is a
separate system: after the Mongo transaction commits, signup writes the Redis
record; if that write fails, it compensates by deleting the user and signup
activity in a second Mongo transaction and removes any staged Redis keys. This
avoids returning a successful signup that cannot enter the OTP flow. The
compensation is used because MongoDB and Redis do not share a distributed
transaction coordinator.

Own-profile reads use cache-aside Redis storage. `USER_CACHE_TTL` defaults to
300 seconds (five minutes), balancing lower database read load with bounded
staleness. Every successful profile/avatar write deletes the cache key and
then writes the updated representation back before returning. Avatar delivery
URLs are regenerated on every cache hit and expire after five minutes.

`PATCH /api/v1/users/me` updates only supplied mutable fields; omitted fields
remain unchanged. `PUT /api/v1/users/me` replaces the mutable profile: omitted
name, email, phone, address, country code, birth date, and avatar are removed.
Password and verification status are not mutable through either profile route.
For example, PATCH with only `{"name":"New name"}` preserves the address,
while PUT with that body clears the other mutable profile fields.

## Signup Avatar Flow

`POST /api/v1/users` accepts an optional avatar in either of these ways:

- Use the signed upload contract and send its `avatarUploadId` with signup.
- Send `avatarBase64` (or `image`) in JSON as a base64 image data URI such as
    `data:image/png;base64,...`. A raw base64 string is also accepted when its
    image format can be detected. `avatar` is accepted as a JSON alias.
- Send `avtarUrl` in JSON as a publicly accessible HTTPS image URL. Cloudinary
    fetches that URL, and the server verifies the uploaded image before attaching
    it. URLs behind login, blocked for remote fetching, or non-HTTPS are rejected.

The API does not accept multipart device files. The client uploads the file
directly to Cloudinary, so the API does not buffer or proxy large binary
requests. Cloudinary does not provide S3-style presigned PUT URLs or a per-upload
maximum-size parameter in its signed upload contract. The service signs allowed
formats and verifies the uploaded object's actual format and size (5 MB maximum)
before attaching it; oversized uploads are rejected and deleted at confirmation.
The size limit is checked after direct transfer, not enforced at Cloudinary's
upload edge.

For profile updates, use `POST /api/v1/users/me/avatar/upload`, directly upload
to the returned Cloudinary URL, then either confirm with
`POST /api/v1/users/me/avatar/confirm` or send the returned `avatarUploadId` in
`PUT /api/v1/users/me` with the rest of the replacement profile fields. `PUT`
or `PATCH /api/v1/users/me` also accept base64 JSON fields named `avtarUrl` or
`avatarBase64`. The response includes both `avatarUrl` and the legacy
`avtarUrl` property with the generated Cloudinary URL.

Profile `PUT` and `PATCH` also accept a device file in multipart form-data under
`avatarUrl`, `avatar`, or `avtarUrl` (JPEG, PNG, or WebP, maximum 5 MB). The API
uploads that file to Cloudinary, verifies the stored object, then updates the
profile. Both `avatarUrl` and `avtarUrl` in the response contain the generated
Cloudinary URL. For the direct-to-Cloudinary flow that avoids sending file bytes
through the API, use the upload-contract and confirmation endpoints above.

1. In Postman, call `POST http://localhost:5000/api/v1/users/avatar/upload`
    with no body. Copy `uploadId`, `uploadUrl`, and every value in `fields` from
    the response.
2. Create a second request using the returned `uploadUrl`. Choose **Body >
    form-data**. Add each returned `fields` entry as a Text field, then add a
    field named `file`, change its type to File, and select the image from your
    device. Let Postman set the multipart `Content-Type`; do not set it manually.
    This request goes directly to Cloudinary, not the signup endpoint.
3. Call `POST http://localhost:5000/api/v1/users` with **Body > raw > JSON**.
    Include the normal signup fields and the returned `uploadId` as
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
user. The API returns HTTP 400 with direct-upload guidance if signup is sent as
multipart form-data. Use form-data only for the direct Cloudinary request.

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
    "hasOtp": false,
    "hashOtp": null,
    "otpExpiresAt": null,
    "attempts": 0,
    "isVerified": false
}
```

Redis also stores `signup:phone:<PHONE>` as a lookup to the user ID. The OTP
is stored as a SHA-256 hash, never as plaintext. OTP metadata expires after
five minutes, failed attempts are limited to five, and successful verification
deletes the active Redis hash and sets `isVerified` to `true`. Search for `signup:user:*` in
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

Base64 data is supported for compatibility, but direct uploads and confirmation
are preferred for device-selected files.

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
