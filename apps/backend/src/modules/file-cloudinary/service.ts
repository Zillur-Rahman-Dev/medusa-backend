import { AbstractFileProviderService, MedusaError } from "@medusajs/framework/utils"
import { v2 as cloudinary } from "cloudinary"
import { Readable } from "stream"
import { v4 as uuidv4 } from "uuid"

type CloudinaryOptions = {
  apiKey: string
  apiSecret: string
  cloudName: string
  folderName?: string
  secure?: boolean
}

class CloudinaryFileProviderService extends AbstractFileProviderService {
  static identifier = "cloudinary"
  protected logger_: any
  protected options_: CloudinaryOptions

  constructor({ logger }: any, options: CloudinaryOptions) {
    super()
    this.logger_ = logger
    this.options_ = options

    cloudinary.config({
      cloud_name: options.cloudName,
      api_key: options.apiKey,
      api_secret: options.apiSecret,
      secure: options.secure ?? true,
    })
  }

  static validateOptions(options: CloudinaryOptions) {
    if (!options.apiKey || !options.apiSecret || !options.cloudName) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "API key, API secret or Cloud Name is required in the cloudinary provider's options."
      )
    }
  }

  async upload(file: any): Promise<{ url: string; key: string }> {
    const publicId = this.generatePublicId(file.filename)

    // Convert Medusa v2 base64 encoded file content into a real binary image Buffer
    let buffer: Buffer
    if (Buffer.isBuffer(file.content)) {
      buffer = file.content
    } else if (typeof file.content === "string") {
      const cleanContent = file.content.replace(/^data:[^;]+;base64,/, "")
      buffer = Buffer.from(cleanContent, "base64")
      // If decoding gave empty buffer, fallback to binary
      if (buffer.length === 0 && file.content.length > 0) {
        buffer = Buffer.from(file.content, "binary")
      }
    } else {
      buffer = Buffer.from(file.content)
    }

    const isImage =
      file.filename?.match(/\.(jpg|jpeg|png|webp|gif|svg|avif|bmp|ico)$/i) ||
      file.mimeType?.startsWith("image/")

    const resourceType = isImage ? "image" : "auto"

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: resourceType,
          public_id: publicId,
          folder: this.options_?.folderName || undefined,
        },
        (error, result) => {
          if (error) return reject(error)
          if (!result) return reject(new Error("No result returned from Cloudinary upload."))
          resolve({
            url: result.secure_url,
            key: result.public_id,
          })
        }
      )

      Readable.from(buffer).pipe(uploadStream)
    })
  }

  async delete(file: any): Promise<void> {
    try {
      await cloudinary.uploader.destroy(file.fileKey, { resource_type: "image" })
    } catch {
      await cloudinary.uploader.destroy(file.fileKey, { resource_type: "auto" })
    }
  }

  async getAsBuffer(file: any): Promise<Buffer> {
    const url = cloudinary.url(file.fileKey, { secure: true })
    const response = await fetch(url)
    return Buffer.from(await response.arrayBuffer())
  }

  async getDownloadStream(file: any): Promise<Readable> {
    const url = cloudinary.url(file.fileKey, { secure: true })
    const response = await fetch(url)
    return Readable.fromWeb(response.body as any)
  }

  async getPresignedDownloadUrl(file: any): Promise<string> {
    return cloudinary.url(file.fileKey, { secure: true })
  }

  protected cleanFilename(filename: string): string {
    return filename
      .replace(/[^a-zA-Z0-9.\-_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase()
  }

  protected generatePublicId(filename: string): string {
    const cleaned = this.cleanFilename(filename)
    const unique = uuidv4()
    return `${unique}_${cleaned}`
  }
}

export default CloudinaryFileProviderService
