# Security Policy

## Overview

Telepatty takes security and responsible vulnerability disclosure seriously.

This repository contains a security-focused messaging application. Although the project implements end-to-end encryption and other security mechanisms, no software can guarantee absolute security.

For details about Telepatty's cryptographic design, threat model, security guarantees, and known limitations, see [`docs/SECURITY-MODEL.md`](docs/SECURITY-MODEL.md).

## Reporting a Vulnerability

If you discover a potential security vulnerability in Telepatty, please report it responsibly.

**Do not publicly disclose security vulnerabilities through GitHub Issues, Discussions, or public pull requests.**

Use GitHub's private vulnerability reporting feature, if enabled, to submit your report.

Your report should include:

- A clear description of the vulnerability.
- The affected component or functionality.
- Steps to reproduce the issue.
- Potential security impact.
- A proof of concept or supporting evidence, if available.

Please avoid including real users' private messages, identity keys, credentials, or other sensitive information in your report.

## Response and Disclosure

The project maintainer will review submitted reports and may request additional information.

Confirmed vulnerabilities will be investigated and addressed according to their severity and impact.

Please allow reasonable time for investigation and remediation before publicly disclosing a vulnerability.

## Security Scope

Reports concerning the following areas are particularly relevant:

- End-to-end encryption and cryptographic key handling.
- Nostr event validation, Gift Wrap, and message authentication.
- Identity management and authentication.
- Local storage, encrypted backups, and application locking.
- WebRTC connections and file transfers.
- Input validation, protocol handling, and denial-of-service vulnerabilities.
- Exposure of sensitive data or private metadata.

## Supported Versions

Security fixes are primarily provided for the latest maintained version of Telepatty.

Older versions may not receive security updates.

## Responsible Disclosure

By reporting a vulnerability privately and allowing reasonable time for remediation, you help protect Telepatty and its users.

Thank you for contributing to the security of Telepatty.
