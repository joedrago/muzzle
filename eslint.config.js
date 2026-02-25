import js from "@eslint/js"
import globals from "globals"

export default [
    js.configs.recommended,
    {
        files: ["**/*.{js,mjs,cjs}"],
        languageOptions: { globals: globals.browser },
        rules: {
            "no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_"
                }
            ]
        }
    },
    {
        files: ["scripts/**/*.js"],
        languageOptions: { globals: globals.node }
    },
    {
        files: ["electron/**/*.{js,cjs}", "forge.config.cjs"],
        languageOptions: { globals: globals.node, sourceType: "commonjs" }
    }
]
