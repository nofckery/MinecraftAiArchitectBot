# Contributing to Autonomous AI Minecraft Architect Bot

Thank you for your interest in contributing to the **Autonomous AI Minecraft Architect Bot**! We welcome contributions from developers, architects, builders, and AI enthusiasts.

This guide outlines our development workflow, coding standards, and how to get your contributions reviewed and merged so anyone can seamlessly collaborate on GitHub.

---

## Table of Contents
1. [Code of Conduct](#1-code-of-conduct)
2. [Development Environment Setup](#2-development-environment-setup)
3. [Architecture & Project Structure](#3-architecture--project-structure)
4. [Contribution Workflow](#4-contribution-workflow)
5. [Coding Standards](#5-coding-standards)
6. [Testing Requirements & Verification](#6-testing-requirements--verification)
7. [Submitting a Pull Request](#7-submitting-a-pull-request)
8. [Reporting Bugs & Requesting Features](#8-reporting-bugs--requesting-features)

---

## 1. Code of Conduct

We are committed to providing a friendly, safe, and welcoming environment for all contributors. Please be respectful, constructive, and collaborative in discussions, issues, and code reviews.

---

## 2. Development Environment Setup

### Prerequisites
- **Node.js**: `>= 20.0.0` (Node 20 LTS or Node 22 LTS recommended)
- **npm**: `>= 10.0.0`
- **Native Build Tools**: Required for `node-canvas` (e.g. `build-essential`, `libcairo2-dev`, `libpango1.0-dev` on Debian/Ubuntu, or Visual Studio C++ Build Tools on Windows).
- **Minecraft Server**: Java Edition 1.20.4 to 26.3 (Paper, Purpur, Fabric, or Vanilla).

### Installation Steps
```bash
# 1. Clone your fork or the main repository
git clone https://github.com/nofckery/MinecraftAiArchitectBot.git
cd MinecraftAiArchitectBot

# 2. Install dependencies
npm install

# 3. Create your local environment configuration
# Windows (PowerShell):
Copy-Item .env.example .env
# Linux / macOS:
cp .env.example .env

# 4. Verify the test suite (100% offline, no live server or API keys required)
npm test
```

---

## 3. Architecture & Project Structure

The project is structured into modular layers designed for strict separation of concerns:

| Directory | Layer | Description |
| :--- | :--- | :--- |
| `src/ai/` | **Cognitive Layer** | Multi-Provider LLM Router (Cerebras, Groq, Mistral/Codestral, Gemini Flash, SambaNova, Cloudflare, NIM, OpenRouter, Zero-Key Kilo/LLM7), Prompt Engineering, Safe Probe Worker, and Architect Agent (with integrated Node:VM Sandbox). |
| `src/bot/` | **Bot Core & Execution** | Mineflayer Bot Client, Session Handoff Manager (1-Account server ping & reconnect), Threat Manager (proactive mob defense, shield block, retreat), Sleep Controller, Manual Controller. |
| `src/builder/` | **Geometry & Synthesis** | VoxelCanvas SDK, ArchPrimitives (12 procedural modules), Structural Linter (BFS gravity statics & clearance), Greedy Mesher (/fill compression), World Executor (2-phase topology builder, anti-kick rate throttling), Universal Schematic Manager (.schem, .litematic, .nbt). |
| `src/config/` | **Config & Versioning** | Version Resolver (26.3 protocol 777 runtime compatibility), Settings parser, and Environment Manager. |
| `src/security/` | **Security & Vault** | AES-256-GCM + Scrypt Encrypted Credential Vault, Device Flow Manager (RFC 8628 GitHub login), MSA Auth Manager. |
| `src/survival/` | **Survival Subsystem** | Chest Manager (32m container scanning & capacity-checked withdrawal), Material Procurement, Scaffold Manager (dynamic placement & cleanup of scaffolding for high-rise builds), Harvest Manager. |
| `src/web/` | **Mission Control Cockpit** | Express + WebSocket server (`dashboardServer.js`), Three.js 3D CAD Editor, 2D Topological Map, Manual Cockpit, Model Cockpit, Area Map, Multi-Monitor Popout Viewer. |
| `src/world/` | **Perception Layer** | World Scanner (bounding-box detection via wool markers, terrain relief analysis), Undo Manager (`undoManager.js` rollback logging). |
| `test/` | **Verification Suite** | 24 standardized offline test suites covering 841 assertions across all modules (100% PASS). |

---

## 4. Contribution Workflow

1. **Fork & Branch**: Create a descriptive feature branch from `main`:
   ```bash
   git checkout -b feat/procedural-bridge-primitive
   # or
   git checkout -b fix/litematic-64bit-unpacker
   ```
2. **Implement**: Keep changes focused on the issue or feature at hand. Follow the minimal change principle and avoid unrelated refactoring.
3. **Test**: Run `npm test` frequently during development to ensure zero regressions.
4. **Commit**: Use Conventional Commits formatting:
   - `feat: add gothic cathedral arch primitive`
   - `fix: resolve stair shape property on south-facing mirror`
   - `docs: update web cad user guide`
   - `test: add unit coverage for 1-account reconnect ping`

---

## 5. Coding Standards

- **Module Format**: Pure ECMAScript Modules (`import` / `export`). Do not use CommonJS `require()`.
- **Node.js APIs**: Use modern built-in Node 20+ features (`node:fs/promises`, `node:path`, `node:vm`, `node:crypto`).
- **Error Handling**: Use structured logging (`logger.info`, `logger.warn`, `logger.error` or ISO timestamps with bracketed levels). Always catch and handle async errors gracefully.
- **Voxel Transformations**:
  - Maintain coordinate consistency `(x, y, z)`.
  - When rotating or mirroring blocks, always transform directional block properties (`facing`, `shape`, `half`, `axis`, `hinge`).
  - Use `VoxelCanvas` primitives rather than raw coordinate arrays.
- **Safe Evaluation**: LLM-generated code must always run inside the isolated `node:vm` sandbox with CPU timeout and memory constraints (integrated into `src/ai/architectAgent.js`).
- **Git Hygiene**: Never commit API keys, personal configs, `.env`, `.vault`, or runtime log files. Ensure `.gitignore` is respected at all times.

---

## 6. Testing Requirements & Verification

All contributions must maintain our high bar of software quality:
- **100% Pass Rate**: `npm test` must pass all 22 test suites without errors.
- **Offline Self-Containment**: Tests must never rely on an external Minecraft server, active internet connection, or live paid API keys. Use mock sockets, dry-run executors, and simulated HTTP responses.
- **New Feature Coverage**: When introducing new ArchPrimitives, schematic formats, or API routes, write corresponding tests in the respective test suite under `test/`.

Available test commands:
```bash
npm test                      # Run all 24 standard test suites (841 tests)
npm run test:dry              # Geometry, procedural synthesis, and LLM router tests
npm run test:mission          # Mission Control WebSocket, CAD, and Session Handoff tests
npm run test:milestone1       # Chest logistics & Minecraft 26.3 compatibility tests
npm run test:milestone2       # Threat Manager, tactical retreat, and sleep tests
npm run test:vault            # AES-256-GCM Credential Vault tests
npm run test:model            # Safe Probe Worker & Model Hot-Reload tests
npm run test:device           # RFC 8628 Device Flow & Local BFF tests
npm run test:settings         # Onboarding Wizard & Settings tests
npm run test:cockpit          # Cockpit backend API tests
npm run test:msa              # Microsoft Auth integration tests
npm run test:builder          # Builder modularization tests
npm run test:scaffold         # Scaffolding manager tests
npm run test:translator       # Viewer state translator tests
npm run test:gamemode         # All manual gamemode tests (Backend, WS, Frontend, Integration, Perfection)
npm run test:gamemode-perfection # Gamemode perfection, HUD & pitch-clamp tests
npm run test:popout           # Multi-monitor popout tests
npm run test:version          # Live protocol & version compatibility tests (1.20 - 26.3)
npm run test:schem            # Universal Schematic SOTA & chat tests
```

---

## 7. Submitting a Pull Request

Before opening a PR:
1. Rebase your branch onto the latest `main`: `git pull --rebase origin main`.
2. Ensure `npm test` runs with 0 errors.
3. Remove any temporary logs or test schematics from your workspace.
4. Provide a clear description in your Pull Request:
   - **Summary of changes**
   - **Motivation / context**
   - **How to test / verify**
   - **Screenshots or CAD views** (if UI/CAD changes were made).

---

## 8. Reporting Bugs & Requesting Features

- **Bug Reports**: Open an issue including your Node.js version, Minecraft server version, server type (Paper, Fabric, Vanilla), error stack trace, and reproduction steps.
- **Feature Requests**: Describe the architectural style, schematic capability, or UI feature you'd like to see, along with practical use cases.