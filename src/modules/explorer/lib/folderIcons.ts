/**
 * Default folder icon associations
 * Keys are icon file basenames (without folder_ prefix)
 */

type FolderIcons = Record<
  string,
  {
    folderNames?: Array<string>;
  }
>;

// @keep-sorted
const folderIcons: FolderIcons = {
  admin: {
    folderNames: [
      "admin",
      "admins",
      "manager",
      "managers",
      "moderator",
      "moderators",
    ],
  },
  android: {
    folderNames: ["android"],
  },
  animation: {
    folderNames: ["anim", "anims", "animation", "animations", "animated"],
  },
  api: {
    folderNames: ["api", "apis", "restapi"],
  },
  app: {
    folderNames: ["app", "apps"],
  },
  assets: {
    folderNames: ["asset", "assets"],
  },
  audio: {
    folderNames: ["aud", "auds", "audio", "audios", "music", "sound", "sounds"],
  },
  audit: {
    folderNames: ["audit", "audits"],
  },
  aws: {
    folderNames: ["aws", ".aws"],
  },
  "azure-devops": {
    folderNames: [".azure-devops", ".azuredevops"],
  },
  "azure-pipelines": {
    folderNames: [".azure-pipelines"],
  },
  benchmark: {
    folderNames: [
      "benchmark",
      "benchmarks",
      "bench",
      "benches",
      "performance",
      "measure",
      "measures",
      "measurement",
    ],
  },
  caddy: {
    folderNames: [".caddy", ".caddyfiles", "caddy", "caddyfiles"],
  },
  cargo: {
    folderNames: [".cargo"],
  },
  "circle-ci": {
    folderNames: [".circleci"],
  },
  client: {
    folderNames: ["client", "clients", "frontend", "frontends", "pwa"],
  },
  cloud: {
    folderNames: ["cloud"],
  },
  command: {
    folderNames: ["command", "commands", "cmd", "cli", "clis"],
  },
  components: {
    folderNames: ["components", "widget", "widgets", "fragments"],
  },
  composables: {
    folderNames: ["composable", "composables"],
  },
  config: {
    folderNames: [
      "cfg",
      "cfgs",
      "conf",
      "confs",
      ".config",
      "config",
      "configs",
      "configuration",
      "configurations",
      "setting",
      ".setting",
      "settings",
      ".settings",
      "META-INF",
      "option",
      "options",
    ],
  },
  connection: {
    folderNames: ["connection", "connections", "integration", "integrations"],
  },
  constant: {
    folderNames: ["constant", "constants"],
  },
  content: {
    folderNames: ["content", "contents"],
  },
  controllers: {
    folderNames: [
      "controller",
      "controllers",
      "service",
      "services",
      "provider",
      "providers",
      "handler",
      "handlers",
    ],
  },
  core: {
    folderNames: ["core"],
  },
  coverage: {
    folderNames: [
      "coverage",
      ".nyc-output",
      ".nyc_output",
      "e2e",
      "it",
      "integration-test",
      "integration-tests",
      "__integration-test__",
      "__integration-tests__",
    ],
  },
  cursor: {
    folderNames: [".cursor"],
  },
  cypress: {
    folderNames: ["cypress", ".cypress"],
  },
  database: {
    folderNames: ["db", "database", "databases", "sql", "data", "_data"],
  },
  debug: {
    folderNames: ["debug", "debugging"],
  },
  devcontainer: {
    folderNames: [".devcontainer"],
  },
  direnv: {
    folderNames: [".direnv"],
  },
  dist: {
    folderNames: [
      "dist",
      "dist-newstyle",
      "out",
      "build",
      "release",
      "bin",
      ".output",
    ],
  },
  docker: {
    folderNames: ["docker", "dockerfiles", ".docker"],
  },
  docs: {
    folderNames: [
      "_post",
      "_posts",
      "doc",
      "docs",
      "document",
      "documents",
      "documentation",
      "post",
      "posts",
      "article",
      "articles",
    ],
  },
  download: {
    folderNames: ["downloads", "download"],
  },
  "drizzle-orm": {
    folderNames: ["drizzle"],
  },
  examples: {
    folderNames: [
      "demo",
      "demos",
      "example",
      "examples",
      "sample",
      "samples",
      "sample-data",
    ],
  },
  fastlane: {
    folderNames: ["fastlane", ".fastlane"],
  },
  firebase: {
    folderNames: ["firebase", ".firebase"],
  },
  fonts: {
    folderNames: ["font", "fonts"],
  },
  forgejo: {
    folderNames: [".forgejo"],
  },
  functions: {
    folderNames: [
      "func",
      "funcs",
      "function",
      "functions",
      "lambda",
      "lambdas",
      "logic",
      "math",
      "maths",
      "calc",
      "calcs",
      "calculation",
      "calculations",
    ],
  },
  fvm: {
    folderNames: [".fvm"],
  },
  git: {
    folderNames: [
      ".git",
      "patches",
      "githooks",
      ".githooks",
      "submodules",
      ".submodules",
    ],
  },
  github: {
    folderNames: [".github", "github"],
  },
  gitlab: {
    folderNames: [".gitlab"],
  },
  gradle: {
    folderNames: ["gradle", ".gradle"],
  },
  graphql: {
    folderNames: ["graphql", "gql"],
  },
  hooks: {
    folderNames: ["hook", "hooks", "trigger", "triggers"],
  },
  husky: {
    folderNames: ["husky", ".husky"],
  },
  images: {
    folderNames: [
      "_images",
      "_image",
      "_imgs",
      "_img",
      "images",
      "image",
      "imgs",
      "img",
      "icons",
      "icon",
      "icos",
      "ico",
      "figures",
      "figure",
      "figs",
      "fig",
      "screenshot",
      "screenshots",
      "screengrab",
      "screengrabs",
      "pic",
      "pics",
      "picture",
      "pictures",
      "photo",
      "photos",
      "photograph",
      "photographs",
    ],
  },
  include: {
    folderNames: ["include", "includes"],
  },
  intellij: {
    folderNames: [".idea"],
  },
  javascript: {
    folderNames: ["js", "javascript"],
  },
  kubernetes: {
    folderNames: ["kubernetes", ".kubernetes", "k8s", ".k8s"],
  },
  layouts: {
    folderNames: ["layout", "layouts", "_layouts"],
  },
  lib: {
    folderNames: [
      "lib",
      "libs",
      "library",
      "libraries",
      ".lib",
      ".libs",
      ".library",
      ".libraries",
    ],
  },
  linux: {
    folderNames: ["linux"],
  },
  locales: {
    folderNames: [
      "i18n",
      "internationalization",
      "lang",
      "langs",
      "language",
      "languages",
      "locale",
      "locales",
      "l10n",
      "localization",
      "translation",
      "translate",
      "translations",
      ".tx",
    ],
  },
  luau: {
    folderNames: ["luau_packages"],
  },
  lune: {
    folderNames: ["lune_packages"],
  },
  macos: {
    folderNames: ["mac", "macos"],
  },
  messages: {
    folderNames: ["message", "messages"],
  },
  middleware: {
    folderNames: ["middleware", "middlewares"],
  },
  mocks: {
    folderNames: [
      "_draft",
      "_drafts",
      "mock",
      "mocks",
      "fixture",
      "fixtures",
      "draft",
      "drafts",
      "concept",
      "concepts",
      "sketch",
      "sketches",
    ],
  },
  moonrepo: {
    folderNames: [".moon"],
  },
  next: {
    folderNames: [".next"],
  },
  nix: {
    folderNames: ["nix"],
  },
  node: {
    folderNames: ["node_modules"],
  },
  nuxt: {
    folderNames: ["nuxt", ".nuxt"],
  },
  packages: {
    folderNames: ["package", "packages", "pkg", "pkgs", "crate", "crates"],
  },
  pesde: {
    folderNames: [".pesde", "pesde"],
  },
  plugins: {
    folderNames: [
      "plugin",
      "plugins",
      "_plugins",
      "mod",
      "mods",
      "modding",
      "extension",
      "extensions",
      "addon",
      "addons",
      "module",
      "modules",
    ],
  },
  "pre-commit": {
    folderNames: ["pre-commit-channel"],
  },
  prisma: {
    folderNames: ["prisma"],
  },
  private: {
    folderNames: ["private"],
  },
  proto: {
    folderNames: ["protobuf", "protobufs", "proto", "protos"],
  },
  public: {
    folderNames: [
      "_site",
      "public",
      "www",
      "wwwroot",
      "web",
      "website",
      "site",
      "browser",
      "browsers",
    ],
  },
  queue: {
    folderNames: ["queue", "queues", "bull", "mq"],
  },
  redux: {
    folderNames: ["redux"],
  },
  renovate: {
    folderNames: [".renovate", "renovate"],
  },
  roblox: {
    folderNames: ["roblox_packages", "roblox_server_packages"],
  },
  routes: {
    folderNames: ["routes", "router", "routers"],
  },
  sass: {
    folderNames: ["sass", "_sass", "scss", "_scss"],
  },
  scripts: {
    folderNames: ["script", "scripts", "scripting"],
  },
  security: {
    folderNames: ["security"],
  },
  server: {
    folderNames: ["server", "servers", "backend"],
  },
  shared: {
    folderNames: ["share", "shared"],
  },
  src: {
    folderNames: ["src", "srcs", "source", "sources", "code"],
  },
  storybook: {
    folderNames: [".storybook", "storybook", "stories", "__stories__"],
  },
  styles: {
    folderNames: ["css", "stylesheet", "stylesheets", "style", "styles"],
  },
  svg: {
    folderNames: ["svg", "svgs"],
  },
  tauri: {
    folderNames: ["src-tauri"],
  },
  temp: {
    folderNames: ["temp", ".temp", "tmp", ".tmp", "cached", "cache", ".cache"],
  },
  templates: {
    folderNames: ["template", "templates"],
  },
  tests: {
    folderNames: [
      "test",
      "tests",
      "testing",
      "__tests__",
      "__snapshots__",
      "__mocks__",
      "__fixtures__",
      "__test__",
      "spec",
      "specs",
    ],
  },
  themes: {
    folderNames: ["theme", "themes"],
  },
  turbo: {
    folderNames: [".turbo"],
  },
  types: {
    folderNames: ["typings", "@types", "types"],
  },
  upload: {
    folderNames: ["uploads", "upload"],
  },
  utils: {
    folderNames: ["util", "utils", "utility", "utilities"],
  },
  vercel: {
    folderNames: ["vercel", ".vercel", "now", ".now"],
  },
  video: {
    folderNames: ["vid", "vids", "video", "videos", "movie", "movies"],
  },
  views: {
    folderNames: [
      "view",
      "views",
      "screen",
      "screens",
      "page",
      "pages",
      "public_html",
      "html",
    ],
  },
  vscode: {
    folderNames: [".vscode", ".vscode-test"],
  },
  windows: {
    folderNames: ["windows"],
  },
  workflows: {
    folderNames: ["workflow", "workflows", "ci", ".ci"],
  },
  wxt: {
    folderNames: [".wxt"],
  },
  xcode: {
    folderNames: ["xcodeproj", "xcworkspace", "xcshareddata", "xcschemes"],
  },
  xmake: {
    folderNames: ["xmake", ".xmake"],
  },
  yarn: {
    folderNames: [".yarn"],
  },
};

const folderNames = Object.entries(folderIcons).reduce<Record<string, string>>(
  (acc, [name, icon]) => ({
    ...acc,
    ...icon.folderNames?.reduce<Record<string, string>>(
      (a, c) => ({ ...a, [c]: `folder_${name}` }),
      {},
    ),
  }),
  {},
);

export { folderIcons, folderNames };
