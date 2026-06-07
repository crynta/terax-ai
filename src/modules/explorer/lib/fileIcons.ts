/**
 * Default file icon associations.
 *
 * The source data is split into alphabetically ordered chunks under
 * ./fileIcons so this module stays a resolver boundary instead of a
 * multi-thousand-line data blob.
 */

import { fileIconsPart1 } from "./fileIcons/part1";
import { fileIconsPart2 } from "./fileIcons/part2";
import { fileIconsPart3 } from "./fileIcons/part3";
import { fileIconsPart4 } from "./fileIcons/part4";
import { fileIconsPart5 } from "./fileIcons/part5";
import { fileIconsPart6 } from "./fileIcons/part6";
import type { FileIcons } from "./fileIcons/types";

const fileIcons: FileIcons = {
  ...fileIconsPart1,
  ...fileIconsPart2,
  ...fileIconsPart3,
  ...fileIconsPart4,
  ...fileIconsPart5,
  ...fileIconsPart6,
};

function toLookupMap(source: FileIcons, key: keyof FileIcons[string]) {
  return Object.entries(source).reduce<Record<string, string>>(
    (lookup, [name, icon]) => {
      for (const value of icon[key] ?? []) {
        lookup[value] = name;
      }
      return lookup;
    },
    {},
  );
}

const languageIds = toLookupMap(fileIcons, "languageIds");
const fileExtensions = toLookupMap(fileIcons, "fileExtensions");
const fileNames = toLookupMap(fileIcons, "fileNames");

export { fileExtensions, fileIcons, fileNames, languageIds };
