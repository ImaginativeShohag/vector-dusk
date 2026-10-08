# Interaction and motion criteria

- New or changed interactive controls must follow the surrounding design and reuse existing hover, pressed, focus, disabled and success/error feedback where applicable. Links styled as buttons need the same hover and press feedback as buttons.
- Keep feedback brief and tied to an action or state change. Prefer existing CSS transitions, animations and helpers over new JavaScript or dependencies. Do not introduce layout shifts or animate artwork colors or geometry as interface feedback.
- Preserve keyboard access, visible focus, accessible names and native link/button semantics. Feedback must not rely on motion alone.
- Respect `prefers-reduced-motion` in both CSS and scripted animation: disable decorative motion and press transforms while keeping visible state feedback. Ambient motion must retain its pause control and visibility checks.
- Verify affected hover, press and keyboard states, reduced-motion behavior and narrow layouts. Distinguish build/static checks from browser verification.
