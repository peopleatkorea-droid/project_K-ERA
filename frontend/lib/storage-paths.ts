function stripWindowsExtendedPrefix(value: string): string {
  return value
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\\\\\?\\/i, "")
    .replace(/^\\\?\\/, "");
}

export function toStorageRootDisplayPath(value: string | null | undefined): string {
  const normalizedValue = stripWindowsExtendedPrefix(String(value ?? "").trim()).replace(/[\\/]+$/, "");
  if (!normalizedValue || !/[\\/]sites$/i.test(normalizedValue)) {
    return normalizedValue;
  }

  const bundleRoot = normalizedValue.replace(/[\\/]sites$/i, "");
  const bundleName = bundleRoot.split(/[\\/]+/).pop()?.toLowerCase();
  return bundleName === "kera_data" ? bundleRoot : normalizedValue;
}
