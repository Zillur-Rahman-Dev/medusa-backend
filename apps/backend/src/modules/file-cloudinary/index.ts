import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import CloudinaryFileProviderService from "./service"

export default ModuleProvider(Modules.FILE, {
  services: [CloudinaryFileProviderService],
})
