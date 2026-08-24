# React + TypeScript + Vite

<!-- portfolio-badges:start -->
<!-- Identity -->
[![phmatray - museum](https://img.shields.io/static/v1?label=phmatray&message=museum&color=blue&logo=github)](https://github.com/phmatray/museum)
![Top language](https://img.shields.io/github/languages/top/phmatray/museum)
[![Stars](https://img.shields.io/github/stars/phmatray/museum?style=social)](https://github.com/phmatray/museum/stargazers)
[![Forks](https://img.shields.io/github/forks/phmatray/museum?style=social)](https://github.com/phmatray/museum/network/members)

<!-- Activity -->
[![Issues](https://img.shields.io/github/issues/phmatray/museum)](https://github.com/phmatray/museum/issues)
[![Pull requests](https://img.shields.io/github/issues-pr/phmatray/museum)](https://github.com/phmatray/museum/pulls)
[![Last commit](https://img.shields.io/github/last-commit/phmatray/museum)](https://github.com/phmatray/museum/commits)
<!-- portfolio-badges:end -->

<!-- portfolio-toc:start -->

## Table of Contents

- [Getting Started](#getting-started)
- [React Compiler](#react-compiler)
- [Expanding the ESLint configuration](#expanding-the-eslint-configuration)
- [Tech Stack](#tech-stack)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

<!-- portfolio-toc:end -->

<!-- portfolio-getstarted:start -->

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/)

### Run

```bash
git clone https://github.com/phmatray/museum.git
cd museum
npm install
npm run dev
```

<!-- portfolio-getstarted:end -->

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

---

<!-- portfolio-techstack:start -->

## Tech Stack

- **TypeScript**
- @react-three/drei
- @react-three/fiber
- @react-three/postprocessing
- @react-three/rapier
- postprocessing
- react
- react-dom
- three

<!-- portfolio-techstack:end -->

<!-- portfolio-roadmap:start -->

## Roadmap

Planned work and known limitations are tracked in the [open issues](https://github.com/phmatray/museum/issues). Contributions toward them are welcome.

<!-- portfolio-roadmap:end -->

<!-- portfolio-sections:start -->

## Contributing

Contributions are welcome. Open an issue first to discuss any significant change.

1. Fork the repository and create your branch (`git checkout -b feat/my-feature`)
2. Commit your changes (`git commit -m 'feat: ...'`)
3. Push the branch and open a Pull Request

## License

No license has been declared for this repository yet. Until one is added, default copyright applies — see [choosealicense.com](https://choosealicense.com/).

<!-- portfolio-sections:end -->
