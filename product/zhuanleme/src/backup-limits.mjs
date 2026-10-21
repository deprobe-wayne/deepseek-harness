// The JSON file limit leaves room for the API envelope under its 32 MiB body limit.
export const backupByteLimit = 30 * 1024 * 1024;
export const backupRowLimit = 200000;
