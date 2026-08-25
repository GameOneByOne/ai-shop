export function isImageUnsupportedError(message: string) {
  return /does not support images?|image (?:input|content) (?:is )?not supported|不支持(?:图片|图像|视觉)/i.test(message);
}

export function productRecognitionMode(visionModel: string | undefined) {
  return visionModel?.trim() ? "vision" as const : "text" as const;
}
