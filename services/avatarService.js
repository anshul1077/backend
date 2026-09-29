import crypto from "crypto";

import cloudinary from "../config/cloudinary.js";
import redisClient from "../config/redis.js";

/*
|--------------------------------------------------------------------------
| Configuration
|--------------------------------------------------------------------------
*/

const AVATAR_MAX_BYTES = Number.parseInt(
  process.env.AVATAR_MAX_BYTES || "5242880",
  10
);

const AVATAR_FOLDER = "user_avatars";

const AVATAR_PENDING_TTL = Number.parseInt(
  process.env.AVATAR_PENDING_TTL || "600",
  10
);

const AVATAR_READ_URL_EXPIRES = Number.parseInt(
  process.env.AVATAR_READ_URL_EXPIRES || "300",
  10
);

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MIME_TO_FORMAT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const FORMAT_TO_MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

const makeError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const pendingAvatarKey = (userId, uploadId) => {
  return `avatar:pending:${userId}:${uploadId}`;
};

/*
|--------------------------------------------------------------------------
| Validation
|--------------------------------------------------------------------------
*/

const validateContentType = (contentType) => {
  if (
    typeof contentType !== "string" ||
    !ALLOWED_TYPES.has(contentType)
  ) {
    throw makeError(
      "Only JPEG, PNG and WEBP images are allowed.",
      400
    );
  }

  return true;
};

const validateSize = (size) => {
  const numericSize = Number(size);

  if (
    !Number.isSafeInteger(numericSize) ||
    numericSize <= 0
  ) {
    throw makeError(
      "Avatar size must be a positive integer.",
      400
    );
  }

  if (numericSize > AVATAR_MAX_BYTES) {
    throw makeError(
      `Avatar image must be ${
        AVATAR_MAX_BYTES / 1024 / 1024
      } MB or smaller.`,
      400
    );
  }

  return numericSize;
};

/*
|--------------------------------------------------------------------------
| Upload Multer Buffer -> Cloudinary
|--------------------------------------------------------------------------
|
| Used by:
|
| POST /signup
| PUT /users/me
| PATCH /users/me
|
| Multer must use memoryStorage().
|
|--------------------------------------------------------------------------
*/

export const uploadAvatarToCloudinary = async (
  file,
  userId = "signup"
) => {
  if (!file) {
    return null;
  }

  if (!file.buffer) {
    throw makeError(
      "Avatar file buffer is missing.",
      400
    );
  }

  validateContentType(file.mimetype);
  validateSize(file.size);

  const format = MIME_TO_FORMAT[file.mimetype];

  if (!format) {
    throw makeError(
      "Unsupported avatar image format.",
      400
    );
  }

  /*
   * Make a unique Cloudinary public ID.
   */
  const publicId = `${String(userId)}/${crypto.randomUUID()}`;

  try {
    const result = await new Promise(
      (resolve, reject) => {
        const uploadStream =
          cloudinary.uploader.upload_stream(
            {
              folder: AVATAR_FOLDER,

              public_id: publicId,

              resource_type: "image",

              type: "upload",

              overwrite: false,

              unique_filename: false,

              use_filename: false,
            },

            (error, uploadResult) => {
              if (error) {
                return reject(error);
              }

              resolve(uploadResult);
            }
          );

        uploadStream.end(file.buffer);
      }
    );

    if (!result) {
      throw makeError(
        "Cloudinary avatar upload failed.",
        500
      );
    }

    return {
      url: result.secure_url,

      publicId: result.public_id,

      format: result.format,

      bytes: result.bytes,

      resourceType:
        result.resource_type,

      width: result.width,

      height: result.height,
    };
  } catch (error) {
    console.error(
      "Cloudinary avatar upload failed:",
      error.message
    );

    if (error.status) {
      throw error;
    }

    throw makeError(
      "Cloudinary avatar upload failed.",
      500
    );
  }
};

/*
|--------------------------------------------------------------------------
| Delete Avatar From Cloudinary
|--------------------------------------------------------------------------
*/

export const deleteCloudinaryAvatar = async (
  publicId,
  folder
) => {
  if (!publicId) {
    return null;
  }

  try {
    const cloudinaryPublicId = folder
      ? `${folder}/${publicId}`
      : publicId;

    const result =
      await cloudinary.uploader.destroy(
        cloudinaryPublicId,
        {
          resource_type: "image",

          type: "upload",

          invalidate: true,
        }
      );

    return result;
  } catch (error) {
    console.error(
      "Cloudinary avatar deletion failed:",
      error.message
    );

    /*
     * Database operation should not be
     * considered failed only because
     * Cloudinary cleanup failed.
     */
    return null;
  }
};

/*
|--------------------------------------------------------------------------
| Create Direct Cloudinary Upload Signature
|--------------------------------------------------------------------------
|
| Optional flow:
|
| Frontend
|    |
|    v
| Backend -> signed parameters
|    |
|    v
| Frontend -> Cloudinary
|
|--------------------------------------------------------------------------
*/

export const createAvatarUpload = async ({
  userId,
  contentType,
  size,
}) => {
  validateContentType(contentType);

  const numericSize = validateSize(size);

  if (!redisClient.isReady) {
    throw makeError(
      "Redis is not available.",
      503
    );
  }

  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    throw makeError(
      "Cloudinary configuration is missing.",
      500
    );
  }

  const uploadId =
    crypto.randomUUID();

  const timestamp =
    Math.floor(
      Date.now() / 1000
    );

  const publicId =
    `${String(userId)}/${crypto.randomUUID()}`;

  /*
   * These parameters must be the same
   * when frontend uploads to Cloudinary.
   */
  const paramsToSign = {
  folder: AVATAR_FOLDER,
  public_id: publicId,
  timestamp,
};

const signature = cloudinary.utils.api_sign_request(
  paramsToSign,
  process.env.CLOUDINARY_API_SECRET
);

  await redisClient.set(
    pendingAvatarKey(
      userId,
      uploadId
    ),
    JSON.stringify({
      uploadId,

      userId:
        String(userId),

      publicId,

      folder:
        AVATAR_FOLDER,

      contentType,

      expectedFormat:
        MIME_TO_FORMAT[
          contentType
        ],

      expectedBytes:
        numericSize,

      timestamp,

      createdAt:
        new Date().toISOString(),
    }),
    {
      EX:
        AVATAR_PENDING_TTL,
    }
  );

  return {
    uploadId,

    cloudName:
      process.env.CLOUDINARY_CLOUD_NAME,

    apiKey:
      process.env.CLOUDINARY_API_KEY,

    timestamp,

    signature,

    folder:
      AVATAR_FOLDER,

    publicId,

    resourceType:
      "image",

    type:
      "upload",

    uploadUrl:
      `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`,

    expiresIn:
      AVATAR_PENDING_TTL,

    maxBytes:
      AVATAR_MAX_BYTES,

    contentType,

    size:
      numericSize,
  };
};

/*
|--------------------------------------------------------------------------
| Get Cloudinary Resource
|--------------------------------------------------------------------------
*/

const getCloudinaryResource = async (publicId, folder) => {
  try {
    const cloudinaryPublicId = folder
      ? `${folder}/${publicId}`
      : publicId;

    console.log("Cloudinary lookup publicId:", cloudinaryPublicId);

    const resource = await cloudinary.api.resource(
      cloudinaryPublicId,
      {
        resource_type: "image",
        type: "upload",
      }
    );

    return resource;
  } catch (error) {
    console.error(
      "Cloudinary resource lookup failed:",
      error?.message
    );

    throw makeError(
      "Uploaded avatar was not found in Cloudinary.",
      400
    );
  }
};


/*
|--------------------------------------------------------------------------
| Confirm Direct Cloudinary Upload
|--------------------------------------------------------------------------
*/

export const confirmAvatarUpload =
  async ({
    userId,
    uploadId,
  }) => {
    if (!redisClient.isReady) {
      throw makeError(
        "Redis is not available.",
        503
      );
    }

    if (
      typeof uploadId !== "string" ||
      !uploadId.trim()
    ) {
      throw makeError(
        "uploadId is required.",
        400
      );
    }

    const key =
      pendingAvatarKey(
        userId,
        uploadId
      );

    const pendingRaw =
      await redisClient.get(key);

    if (!pendingRaw) {
      throw makeError(
        "Avatar upload was not found or has expired. Please request a new upload.",
        400
      );
    }

    let pending;

    try {
      pending =
        JSON.parse(pendingRaw);
    } catch {
      throw makeError(
        "Invalid pending avatar upload data.",
        400
      );
    }

    if (
      pending.userId !==
      String(userId)
    ) {
      throw makeError(
        "Invalid avatar upload.",
        403
      );
    }
    const resource =
    await getCloudinaryResource(
        pending.publicId,
        pending.folder
    );        

    /*
     * Verify resource type.
     */
    if (
      resource.resource_type !==
      "image"
    ) {
      await deleteCloudinaryAvatar(
        pending.publicId,
        pending.folder
      );

      throw makeError(
        "Uploaded file is not an image.",
        400
      );
    }

    /*
     * Verify delivery type.
     */
    if (
      resource.type !==
      "upload"
    ) {
      await deleteCloudinaryAvatar(
        pending.publicId,
        pending.folder
      );

      throw makeError(
        "Avatar security configuration is invalid.",
        400
      );
    }

    /*
     * Verify size.
     */
    const actualBytes =
      Number(resource.bytes);

    if (
      !Number.isSafeInteger(
        actualBytes
      ) ||
      actualBytes <= 0
    ) {
      await deleteCloudinaryAvatar(
        pending.publicId,
        pending.folder
      );

      throw makeError(
        "Cloudinary returned an invalid avatar size.",
        400
      );
    }

    if (
      actualBytes >
      AVATAR_MAX_BYTES
    ) {
      await deleteCloudinaryAvatar(
        pending.publicId,
        pending.folder
      );

      throw makeError(
        `Avatar image must be ${
          AVATAR_MAX_BYTES / 1024 / 1024
        } MB or smaller.`,
        400
      );
    }

    /*
     * Verify declared size.
     */
    if (
      actualBytes !==
      pending.expectedBytes
    ) {
      await deleteCloudinaryAvatar(
        pending.publicId,
        pending.folder
      );

      throw makeError(
        "Uploaded avatar size does not match the declared file size.",
        400
      );
    }

    /*
     * Verify format.
     */
    const actualFormat =
      resource.format?.toLowerCase();

    if (
      ![
        "jpg",
        "jpeg",
        "png",
        "webp",
      ].includes(
        actualFormat
      )
    ) {
      await deleteCloudinaryAvatar(
        pending.publicId,
        pending.folder
      );

      throw makeError(
        "Only JPEG, PNG and WEBP images are allowed.",
        400
      );
    }

    /*
     * Verify MIME type.
     */
    const actualContentType =
      FORMAT_TO_MIME[
        actualFormat
      ];

    if (
      actualContentType !==
      pending.contentType
    ) {
      await deleteCloudinaryAvatar(
        pending.publicId,
        pending.folder
      );

      throw makeError(
        "Uploaded avatar content type is invalid.",
        400
      );
    }

    /*
     * Remove pending Redis record
     * after successful confirmation.
     */
    await redisClient.del(key);

    return {
      publicId:
        resource.public_id,

      format:
        actualFormat,

      bytes:
        actualBytes,

      contentType:
        actualContentType,

      assetId:
        resource.asset_id,

      version:
        resource.version,

      url:
        resource.secure_url || null,
    };
  };

/*
|--------------------------------------------------------------------------
| Create Avatar Read URL
|--------------------------------------------------------------------------
|
| Current avatar assets are type: upload.
|
|--------------------------------------------------------------------------
*/

export const createAvatarReadUrl =
  async ({
    publicId,
    format,
  }) => {
    if (!publicId) {
      return null;
    }

    /*
     * For normal Cloudinary upload assets,
     * secure URL can be generated directly.
     */
    const url =
      cloudinary.url(
        publicId,
        {
          resource_type:
            "image",

          type:
            "upload",

          secure:
            true,

          format:
            format || undefined,
        }
      );

    return url;
  };

/*
|--------------------------------------------------------------------------
| Delete Pending Avatar
|--------------------------------------------------------------------------
*/

export const deletePendingAvatar =
  async ({
    userId,
    uploadId,
  }) => {
    if (!redisClient.isReady) {
      return;
    }

    await redisClient.del(
      pendingAvatarKey(
        userId,
        uploadId
      )
    );
  };

/*
|--------------------------------------------------------------------------
| Default Export
|--------------------------------------------------------------------------
*/

export default {
  uploadAvatarToCloudinary,

  createAvatarUpload,

  confirmAvatarUpload,

  deleteCloudinaryAvatar,

  createAvatarReadUrl,

  deletePendingAvatar,
};