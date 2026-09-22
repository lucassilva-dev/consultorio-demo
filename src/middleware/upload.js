const path = require("path");
const multer = require("multer");
const { AppError } = require("../lib/errors");
const { persistImage } = require("../services/storage");

function createUploadMiddleware(runtimeConfig) {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: runtimeConfig.maxUploadBytes,
      files: 1
    }
  });
}

async function storeUploadedImage(file, runtimeConfig) {
  if (!file) {
    throw new AppError("Selecione um arquivo de imagem.", 400);
  }

  const originalExtension = path.extname(file.originalname || "").toLowerCase();
  if (!runtimeConfig.allowedUploadExtensions.includes(originalExtension)) {
    throw new AppError("Extensão de arquivo não permitida.", 400);
  }

  const detectedType = detectImageType(file.buffer);
  if (!detectedType || !runtimeConfig.allowedUploadMimeTypes.includes(detectedType.mime)) {
    throw new AppError("Tipo real do arquivo inválido.", 400);
  }

  const canonicalExtension = detectedType.extension;

  if (!canonicalExtension) {
    throw new AppError("Tipo de imagem não suportado.", 400);
  }

  if (
    detectedType.mime === "image/jpeg" &&
    ![".jpg", ".jpeg"].includes(originalExtension)
  ) {
    throw new AppError("Extensão e tipo real do arquivo não conferem.", 400);
  }

  if (
    detectedType.mime !== "image/jpeg" &&
    originalExtension !== canonicalExtension
  ) {
    throw new AppError("Extensão e tipo real do arquivo não conferem.", 400);
  }

  return persistImage(file, runtimeConfig, canonicalExtension, detectedType);
}

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return null;
  }

  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (isJpeg) {
    return {
      mime: "image/jpeg",
      extension: ".jpg"
    };
  }

  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const isPng = pngSignature.every((byte, index) => buffer[index] === byte);
  if (isPng) {
    return {
      mime: "image/png",
      extension: ".png"
    };
  }

  const riff = buffer.subarray(0, 4).toString("ascii");
  const webp = buffer.subarray(8, 12).toString("ascii");
  if (riff === "RIFF" && webp === "WEBP") {
    return {
      mime: "image/webp",
      extension: ".webp"
    };
  }

  return null;
}

module.exports = {
  createUploadMiddleware,
  storeUploadedImage
};
