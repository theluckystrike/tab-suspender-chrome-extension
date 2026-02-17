# Contributing to Tab Suspender

Thank you for your interest in contributing to Tab Suspender! We welcome contributions from everyone.

## How to Contribute

### Reporting Bugs

If you find a bug, please [open an issue](https://github.com/theluckystrike/tab-suspender-chrome-extension/issues/new?template=bug_report.md) with:

- A clear, descriptive title
- Steps to reproduce the issue
- Expected vs actual behavior
- Your Chrome version and OS
- Screenshots if applicable

### Suggesting Features

Have an idea? [Open a feature request](https://github.com/theluckystrike/tab-suspender-chrome-extension/issues/new?template=feature_request.md) and describe:

- What problem the feature would solve
- How you envision the feature working
- Any alternatives you've considered

### Submitting Pull Requests

1. **Fork** the repository
2. **Clone** your fork locally
3. **Create a branch** for your change: `git checkout -b feature/my-feature`
4. **Make your changes** in the `src/` directory
5. **Test** your changes by loading the extension unpacked in Chrome
6. **Commit** with a clear message: `git commit -m "Add: description of change"`
7. **Push** to your fork: `git push origin feature/my-feature`
8. **Open a Pull Request** against the `main` branch

### Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/theluckystrike/tab-suspender-chrome-extension.git
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable **Developer mode** (toggle in the top right)

4. Click **Load unpacked** and select the `src/` directory

5. Make changes to files in `src/` -- the extension will reload automatically when you click the refresh icon on the extensions page

### Code Style

- Use consistent indentation (4 spaces)
- Follow existing naming conventions in the codebase
- Add comments for complex logic
- Keep functions focused and concise
- Use `const` and `let` over `var`
- Use template literals for string interpolation
- Handle errors with try/catch blocks

### Commit Message Convention

- `Add:` for new features
- `Fix:` for bug fixes
- `Update:` for enhancements to existing features
- `Refactor:` for code restructuring
- `Docs:` for documentation changes
- `Style:` for formatting/CSS changes

### What We Look For in PRs

- Clean, readable code
- No introduction of external dependencies (the extension should remain self-contained)
- No data collection, analytics, or tracking code
- Backwards compatibility with existing settings
- Testing across different Chrome versions

## Code of Conduct

- Be respectful and constructive in all interactions
- Focus on the technical merits of contributions
- Welcome newcomers and help them get started
- Keep discussions on topic

## Questions?

If you have questions about contributing, feel free to [open a discussion](https://github.com/theluckystrike/tab-suspender-chrome-extension/discussions) or reach out at hello@zovo.one.

Thank you for helping make Tab Suspender better!
