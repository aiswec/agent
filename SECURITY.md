# Security

AISWEC runs in your repository's GitHub Actions with your secrets. If you find a way to make it
leak a secret, act for someone who is not a maintainer, or write where it should not, please tell
us privately before anyone else.

- Use **Report a vulnerability** on this repository's Security tab, or
- email **hello@aiswec.com**.

Say what you did, what happened and what you expected. We reply as soon as we can, and we credit
you when the fix ships, unless you would rather we did not.

Only the current `v2` is supported: every project calls the stages at `@v2`, so a fix reaches
everyone the moment it is published.

How AISWEC is built to be safe, and what it can and cannot touch, is in
[docs/security.md](docs/security.md).
