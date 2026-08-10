import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out/**', 'release/**', 'dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          // `const { secret: _secret, ...rest } = value` is how the stores strip
          // the API key out of a public shape.
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true
        }
      ],
      eqeqeq: ['error', 'always']
    }
  },
  {
    files: ['src/renderer/**/*.ts', 'src/preload/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } }
  }
)
