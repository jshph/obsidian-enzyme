---
name: obsidian-plugin-relesae
description: Cut and publish releases for this repository's Obsidian plugin. Use when the user asks to cut, publish, ship, tag, or create the next release for the local obsidian-enzyme repo, including version bumps in package.json and manifest.json, production builds, git tags, GitHub releases, and Obsidian plugin assets.
---

# Obsidian Plugin Release

This skill is local to this repo. Use it to release the Obsidian plugin from the current checkout.

## Release Workflow

1. Confirm state:
   - Run `git status --short --branch`.
   - Run `git tag --sort=-version:refname | head -20`.
   - Run `git log --oneline --decorate --max-count=10`.
   - Do not release with unrelated dirty changes unless the user explicitly says to include them.

2. Choose the next version:
   - Use the numeric tag series without `v`, such as `0.4.2`.
   - Infer the next patch version from the latest numeric release tag unless the user asks for minor or major.
   - Keep `package.json` and `manifest.json` versions identical.

3. Update version files:
   - Edit only `package.json` and `manifest.json` for the version bump unless another version file exists.
   - Use `apply_patch` for manual edits.
   - Verify with `rg -n '<old-version>|version' package.json manifest.json README.md bun.lock`.

4. Build:
   - Run `bun run build`.
   - Confirm release assets exist at repo root: `main.js`, `manifest.json`, `styles.css`.
   - `main.js` is ignored by git in this repo; attach it to the GitHub release, do not force-add it.

5. Commit and push:
   - Commit the version bump as `Release <version>`.
   - Push `master` to `origin`.
   - Create and push tag `<version>`.
   - If HTTPS upload fails with HTTP 408 or sideband disconnect, inspect whether large binary assets are involved. Prefer Git LFS for binary preview assets and retry after reducing oversized GIFs when necessary.

6. Create GitHub release:
   - Use `gh release create <version> main.js manifest.json styles.css --title "<version>" --notes "<notes>"`.
   - Build release notes from commits since the previous release tag.
   - Keep notes concise and user-facing.

7. Verify:
   - Run `git status --short --branch`.
   - Run `git log --oneline --decorate --max-count=5`.
   - Run `gh release view <version> --json tagName,name,isDraft,isPrerelease,assets,url`.
   - Confirm `master` equals `origin/master`, the tag points at the release commit, and all three assets are uploaded.

## Repo Details

- Plugin manifest: `manifest.json`
- Package metadata: `package.json`
- Build command: `bun run build`
- Release assets: `main.js`, `manifest.json`, `styles.css`
- Main branch: `master`
- Remote: `origin`
- Current tag style: `0.x.y`, not `v0.x.y`

## Final Response

Report the release URL, version, commit/tag result, uploaded assets, and any verification gaps. Keep it short.
