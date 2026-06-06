export type FileIconDefinition = {
  languageIds?: string[];
  fileExtensions?: string[];
  fileNames?: string[];
};

export type FileIcons = Record<string, FileIconDefinition>;
