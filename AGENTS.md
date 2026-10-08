# Interaction and motion criteria

- New or changed interactive controls must follow the surrounding design and reuse existing hover, pressed, focus, disabled and success/error feedback where applicable. Links styled as buttons need the same hover and press feedback as buttons.
- Keep feedback brief and tied to an action or state change. Prefer existing CSS transitions, animations and helpers over new JavaScript or dependencies. Do not introduce layout shifts or animate artwork colors or geometry as interface feedback.
- Preserve keyboard access, visible focus, accessible names and native link/button semantics. Feedback must not rely on motion alone.
- Respect `prefers-reduced-motion` in both CSS and scripted animation: disable decorative motion and press transforms while keeping visible state feedback. Ambient motion must retain its pause control and visibility checks.
- Verify affected hover, press and keyboard states, reduced-motion behavior and narrow layouts. Distinguish build/static checks from browser verification.

# Release version criteria

- Every release must increase the project version. Calculate the proposed version from changes since the previous release: major for breaking changes, minor for backward-compatible features, patch for fixes and polish only.
- Explain the proposed version and ask the user for explicit approval before changing version fields or publishing. Release authorization alone does not approve the version number.
- After approval, keep `package.json`, the root project versions in `package-lock.json`, and the visible footer version and accessible label in `index.html` synchronized. Verify these agree before committing and publishing.
