import type { StorageMode } from "@dbrb/shared";
import type { IconName } from "../../components/Icon";

/** The icon each storage option is shown with, wherever it appears. */
export const MODE_ICONS: Record<StorageMode, IconName> = {
  local: "hardDrive",
  platform_s3: "cloud",
  own_s3: "key",
};
