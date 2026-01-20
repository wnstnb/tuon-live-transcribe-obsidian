import tseslint, {
	type ConfigWithExtends,
	type InfiniteDepthConfigWithExtends
} from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));
const obsidianRecommended =
	obsidianmd.configs?.recommended as
		| ConfigWithExtends
		| ConfigWithExtends[]
		| undefined;
const obsidianConfigs: InfiniteDepthConfigWithExtends[] = Array.isArray(
	obsidianRecommended
)
	? obsidianRecommended
	: obsidianRecommended
		? [obsidianRecommended]
		: [];

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianConfigs,
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);
