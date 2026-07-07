import type { StreamParser } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

type LanguageLoader = () => Promise<Extension>;

export interface LanguageDefinition {
  name: string;
  extensions: string[];
  loader: LanguageLoader;

  filenames?: string[];
  userSelectable?: boolean;
}

async function defineLanguage(
  parser: Promise<StreamParser<unknown>>,
): Promise<Extension> {
  const [{ StreamLanguage }, resolvedParser] = await Promise.all([
    import("@codemirror/language"),
    parser,
  ]);
  return StreamLanguage.define(resolvedParser);
}

export const LANGUAGES: LanguageDefinition[] = [
  {
    name: "JavaScript",
    extensions: ["js", "cjs", "mjs"],
    loader: () =>
      import("@codemirror/lang-javascript").then((m) => m.javascript()),
    userSelectable: true,
  },
  {
    name: "TypeScript",
    extensions: ["ts", "cts", "mts"],
    loader: () =>
      import("@codemirror/lang-javascript").then((m) =>
        m.javascript({ typescript: true }),
      ),
    userSelectable: true,
  },
  {
    name: "JavaScript React",
    extensions: ["jsx"],
    loader: () =>
      import("@codemirror/lang-javascript").then((m) =>
        m.javascript({ jsx: true }),
      ),
    userSelectable: true,
  },
  {
    name: "TypeScript React",
    extensions: ["tsx"],
    loader: () =>
      import("@codemirror/lang-javascript").then((m) =>
        m.javascript({ jsx: true, typescript: true }),
      ),
    userSelectable: true,
  },
  {
    name: "Rust",
    extensions: ["rs"],
    loader: () => import("@codemirror/lang-rust").then((m) => m.rust()),
    userSelectable: true,
  },
  {
    name: "Go",
    extensions: ["go"],
    loader: () => import("@codemirror/lang-go").then((m) => m.go()),
    userSelectable: true,
  },
  {
    name: "Python",
    extensions: ["py"],
    loader: () => import("@codemirror/lang-python").then((m) => m.python()),
    userSelectable: true,
  },
  {
    name: "JSON",
    extensions: ["json", "jsonc", "json5"],
    loader: () => import("@codemirror/lang-json").then((m) => m.json()),
    filenames: [".eslintrc", ".babelrc", ".prettierrc"],
    userSelectable: true,
  },
  {
    name: "SQL",
    extensions: ["sql"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/sql").then((m) => m.standardSQL),
      ),
    userSelectable: true,
  },
  {
    name: "PostgreSQL",
    extensions: ["psql", "pgsql"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/sql").then((m) => m.pgSQL),
      ),
  },
  {
    name: "MySQL",
    extensions: ["mysql"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/sql").then((m) => m.mySQL),
      ),
  },
  {
    name: "SQLite",
    extensions: ["sqlite"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/sql").then((m) => m.sqlite),
      ),
  },
  {
    name: "MariaDB",
    extensions: ["mariadb"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/sql").then((m) => m.mariaDB),
      ),
  },
  {
    name: "MSSQL",
    extensions: ["mssql"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/sql").then((m) => m.msSQL),
      ),
  },
  {
    name: "PL/SQL",
    extensions: ["plsql"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/sql").then((m) => m.plSQL),
      ),
  },
  {
    name: "Markdown",
    extensions: ["md", "markdown"],
    loader: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
    userSelectable: true,
  },
  {
    name: "HTML",
    extensions: ["html", "htm", "svelte", "twig"],
    loader: () => import("@codemirror/lang-html").then((m) => m.html()),
    userSelectable: true,
  },
  {
    name: "Astro",
    extensions: ["astro"],
    loader: () =>
      import("@codemirror/lang-html").then((m) =>
        m.html({ selfClosingTags: true }),
      ),
  },
  {
    name: "CSS",
    extensions: ["css"],
    loader: () => import("@codemirror/lang-css").then((m) => m.css()),
    userSelectable: true,
  },
  {
    name: "Vue",
    extensions: ["vue"],
    loader: () => import("@codemirror/lang-vue").then((m) => m.vue()),
  },
  {
    name: "PHP",
    extensions: ["php"],
    loader: () =>
      import("@codemirror/lang-php").then((m) => m.php({ plain: true })),
  },
  {
    name: "C",
    extensions: ["c", "h"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/clike").then((m) => m.c),
      ),
    userSelectable: true,
  },
  {
    name: "C++",
    extensions: ["cpp", "cc", "cxx", "hpp", "hxx"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/clike").then((m) => m.cpp),
      ),
    userSelectable: true,
  },
  {
    name: "C#",
    extensions: ["cs"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/clike").then((m) => m.csharp),
      ),
    userSelectable: true,
  },
  {
    name: "Java",
    extensions: ["java"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/clike").then((m) => m.java),
      ),
    userSelectable: true,
  },
  {
    name: "Kotlin",
    extensions: ["kt", "kts"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/clike").then((m) => m.kotlin),
      ),
    userSelectable: true,
  },
  {
    name: "Scala",
    extensions: ["scala", "sc"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/clike").then((m) => m.scala),
      ),
  },
  {
    name: "Swift",
    extensions: ["swift"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/swift").then((m) => m.swift),
      ),
    userSelectable: true,
  },
  {
    name: "Ruby",
    extensions: ["rb", "rake", "gemspec", "ru"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/ruby").then((m) => m.ruby),
      ),
    filenames: [
      "gemfile",
      "rakefile",
      "podfile",
      "fastfile",
      "guardfile",
      "brewfile",
    ],
    userSelectable: true,
  },
  {
    name: "Shell",
    extensions: ["sh", "bash", "zsh"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/shell").then((m) => m.shell),
      ),
    userSelectable: true,
  },
  {
    name: "TOML",
    extensions: ["toml"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/toml").then((m) => m.toml),
      ),
    userSelectable: true,
  },
  {
    name: "YAML",
    extensions: ["yaml", "yml"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/yaml").then((m) => m.yaml),
      ),
    filenames: ["pubspec.yaml", "pubspec.lock", "analysis_options.yaml"],
    userSelectable: true,
  },
  {
    name: "Dockerfile",
    extensions: ["dockerfile"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/dockerfile").then(
          (m) => m.dockerFile,
        ),
      ),
    filenames: ["dockerfile", "dockerfile.dev"],
  },
  {
    name: "LaTeX",
    extensions: ["tex", "latex", "sty", "cls"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/stex").then((m) => m.stex),
      ),
  },
  {
    name: "Dart",
    extensions: ["dart"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/clike").then((m) => m.dart),
      ),
  },
  {
    name: "Visual Basic",
    extensions: ["vb"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/vb").then((m) => m.vb),
      ),
  },
  {
    name: "XML",
    extensions: [
      "xml",
      "iml",
      "xsd",
      "xsl",
      "xslt",
      "svg",
      "plist",
      "csproj",
      "props",
      "targets",
    ],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/xml").then((m) => m.xml),
      ),
    userSelectable: true,
  },
  {
    name: "nginx",
    extensions: ["conf", "nginx"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/nginx").then((m) => m.nginx),
      ),
    filenames: ["nginx.conf"],
  },
  {
    name: "CMake",
    extensions: ["cmake"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/cmake").then((m) => m.cmake),
      ),
    filenames: ["cmakelists.txt"],
  },
  {
    name: "Properties",
    extensions: ["ini", "cfg", "properties", "env"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/properties").then(
          (m) => m.properties,
        ),
      ),
    filenames: [".env", ".editorconfig"],
  },
  {
    name: "Lua",
    extensions: ["lua"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/lua").then((m) => m.lua),
      ),
  },
  {
    name: "PowerShell",
    extensions: ["ps1", "psm1", "psd1"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/powershell").then(
          (m) => m.powerShell,
        ),
      ),
  },
  {
    name: "Perl",
    extensions: ["pl", "pm"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/perl").then((m) => m.perl),
      ),
  },
  {
    name: "Groovy",
    extensions: ["groovy", "gradle"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/groovy").then((m) => m.groovy),
      ),
  },
  {
    name: "Clojure",
    extensions: ["clj", "cljs", "cljc", "edn"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/clojure").then((m) => m.clojure),
      ),
  },
  {
    name: "Haskell",
    extensions: ["hs"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/haskell").then((m) => m.haskell),
      ),
  },
  {
    name: "Diff",
    extensions: ["diff", "patch"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/diff").then((m) => m.diff),
      ),
  },
  {
    name: "Proto",
    extensions: ["proto"],
    loader: () =>
      defineLanguage(
        import("@codemirror/legacy-modes/mode/protobuf").then(
          (m) => m.protobuf,
        ),
      ),
  },
  {
    name: "Terax Theme",
    extensions: ["terax-theme"],
    loader: async () => {
      const [{ json }, { colorSwatches }] = await Promise.all([
        import("@codemirror/lang-json"),
        import("./colorSwatches"),
      ]);
      return [json(), colorSwatches()];
    },
  },
];

export const ALL_LANGUAGES = [...LANGUAGES]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((l) => ({ name: l.name, ext: l.extensions[0] }));

export const EXPOSED_LANGUAGES = LANGUAGES.filter((l) => l.userSelectable).map(
  (l) => ({ name: l.name, ext: l.extensions[0] }),
);

export const extensionMap = new Map<string, LanguageDefinition>();
export const filenameMap = new Map<string, LanguageDefinition>();

for (const lang of LANGUAGES) {
  lang.extensions?.forEach((ext) => {
    extensionMap.set(ext.toLowerCase(), lang);
  });
  lang.filenames?.forEach((file) => {
    filenameMap.set(file.toLowerCase(), lang);
  });
}
