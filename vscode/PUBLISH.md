# Publish the VS Code extension

The workflow `.github/workflows/vscode.yml` publishes the extension to the Visual Studio Marketplace and to Open VSX. VS Code uses the Marketplace. VSCodium, Cursor, Windsurf, Gitpod, and other forks of VS Code use Open VSX. Both registries accept trusted publishing (OIDC) from GitHub Actions, so the repository stores no token, except for one Open VSX token for the first version.

A person must do the steps below. They need accounts, agreements, and settings on web pages.

## 1. Decide

- **Publisher ID.** `vscode/package.json` has `"publisher": "ubqtest"`. The ID of the extension is then `ubqtest.ubq`. You cannot change a Marketplace publisher ID after you create it. The Open VSX namespace must be the same text, with the same case. If you want a different ID, change `publisher` before the first publish.
- **Version.** `vscode/package.json` has `0.0.0`. The workflow does not publish `0.0.0`. The Marketplace accepts only `major.minor.patch`, with no pre-release tag such as `-beta.1`. You cannot use a version number again after you delete it.
- **Icon (optional).** A PNG of 128x128 pixels or more, in `vscode/`, named in `"icon"` in `vscode/package.json`, and added to `vscode/.vscodeignore` with a `!` line. The Marketplace refuses an SVG icon.

## 2. Visual Studio Marketplace

1. Sign in at https://marketplace.visualstudio.com/manage with a Microsoft account.
2. Click **Create publisher**. Set **ID** to the publisher ID from step 1, and **Name** to the name to show (for example `ubq`). Click **Create**.
3. Open the publisher, then **Trusted Publishing**, then **Create**. Fill in:
   - **Policy name**: `Release workflow`
   - **Repository owner**: `isaacs`
   - **Repository**: `ubqtest`
   - **Workflow**: `vscode.yml`
   - **Environment**: `vscode`
4. Click **Create**.

With trusted publishing, you need no Azure DevOps personal access token. Azure DevOps stops global tokens on December 1, 2026.

The Marketplace docs do not say if trusted publishing works for the first version of an extension. If the first run fails at this step for that reason, publish the first version by hand: `npx vsce publish --packagePath ubq.vsix` from `vscode/`, with a token from an Azure DevOps organization (scope **Marketplace (Manage)**).

## 3. Open VSX

1. Sign in at https://open-vsx.org with your GitHub account.
2. Make an Eclipse account at https://accounts.eclipse.org/user/register. In **GitHub Username**, put the same GitHub account.
3. On open-vsx.org, open **Settings** (your avatar), click **Log in with Eclipse**, and allow it. Click **Show Publisher Agreement**, read it, and click **Agree**.
4. In **Settings**, **Access Tokens**, click **Generate New Token**. Copy the token. The page shows it one time only.
5. Make the namespace: `npx ovsx create-namespace ubqtest -p <token>`.
6. Ask for ownership of the namespace. The page "Namespace Access" of the Open VSX wiki (https://github.com/eclipse-openvsx/openvsx/wiki) tells how. Trusted publishing needs an owner, not only a contributor.

Trusted publishing on Open VSX works only for an extension that has a version. Step 5 below publishes the first one with the token. Then:

7. In **Settings**, **Trusted Publishers**, pick the namespace and GitHub Actions. Fill in the user `isaacs`, the repository `ubqtest`, the workflow `vscode.yml`, and the environment `vscode`.
8. Remove the secret `OVSX_PAT` (step 4 below), and delete the token in **Access Tokens**.

## 4. GitHub

1. In the repository **Settings**, **Environments**, make the environment `vscode`. Add yourself as a required reviewer, so a run waits for you.
2. For the first version only: in that environment, add the secret `OVSX_PAT` with the Open VSX token.

## 5. Publish

1. Set the version in `vscode/package.json`, and commit it.
2. Start the workflow: on the Actions page, or `gh workflow run vscode.yml`.
3. After the first version, do steps 7 and 8 of section 3.

The workflow publishes only. The CI workflow runs the tests of the extension in a real VS Code.

## Later (optional)

- **Verified publisher on the Marketplace.** This needs an extension on the Marketplace for 6 months, and a domain registered 6 months ago (such as `ubq.dev`). On the publisher page, **Details**, **Verified domain**, then a DNS TXT record.
- **Verified namespace on Open VSX.** An owner can ask for it on the wiki page "Namespace Access".
