# Contributing to meteor-cloud-run

Thank you for your interest in contributing to meteor-cloud-run! This document provides guidelines for contributing to the project.

## How to Contribute

### Reporting Issues

Before creating an issue, please:

1. **Search existing issues** to see if the problem has already been reported
2. **Check the documentation** - many questions are answered in [docs/](docs/)
3. **Test with the latest version** of meteor-cloud-run

When creating an issue, please include:
- meteor-cloud-run version (`meteor-cloud-run --version`)
- Meteor version (`meteor --version`)
- Node.js version (`node --version`)
- Operating system
- Complete error messages
- Steps to reproduce the issue
- Output of `meteor-cloud-run info --verbose` (if applicable)

### Suggesting Features

Feature requests are welcome! Please:

1. Check if the feature already exists or is planned
2. Explain the use case and why it would be valuable
3. Provide examples of how the feature would work
4. Consider backward compatibility

### Contributing Code

#### Prerequisites

- Node.js >= 18
- Google Cloud CLI installed and configured
- Access to a Google Cloud project for testing
- Familiarity with Meteor.js and Google Cloud Run

#### Development Setup

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/your-username/meteor-cloud-run.git
   cd meteor-cloud-run
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Link for local development:**
   ```bash
   npm link
   ```

4. **Test your installation:**
   ```bash
   meteor-cloud-run --version
   ```

#### Making Changes

1. **Create a feature branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes:**
   - Follow existing code style and conventions
   - Add comments for complex logic
   - Update documentation if needed

3. **Test your changes:**
   ```bash
   # Test with a real Meteor app
   cd /path/to/test/meteor/app
   meteor-cloud-run init
   meteor-cloud-run deploy --verbose
   ```

4. **Update documentation:**
   - Update relevant files in `docs/` if needed
   - Update README.md if adding new features
   - Add examples for new functionality

#### Code Style Guidelines

- Use consistent indentation (2 spaces)
- Use descriptive variable and function names
- Add JSDoc comments for functions
- Follow existing error handling patterns
- Use async/await instead of callbacks
- Validate user inputs appropriately

#### Testing

Currently, testing requires manual verification with real Google Cloud projects. Please test:

1. **Basic functionality:**
   - `meteor-cloud-run init` with various configurations
   - `meteor-cloud-run deploy` with different settings
   - `meteor-cloud-run info` shows correct information

2. **Edge cases:**
   - Invalid configurations
   - Authentication failures
   - Network issues
   - Large applications

3. **Documentation:**
   - All examples in documentation work correctly
   - Links are not broken
   - Instructions are clear and complete

#### Pull Request Process

1. **Update documentation** for any new features
2. **Test thoroughly** with real deployments
3. **Write clear commit messages** describing what changed
4. **Create a pull request** with:
   - Clear title describing the change
   - Detailed description of what was changed and why
   - Any breaking changes clearly noted
   - Screenshots or examples if relevant

### Documentation Contributions

Documentation improvements are highly valued! You can:

- Fix typos and grammar errors
- Improve clarity of explanations
- Add missing examples
- Update outdated information
- Translate documentation (future)

Documentation is located in:
- `README.md` - Main project overview
- `docs/` - Detailed guides
- Code comments - Inline documentation

### Code of Conduct

This project follows a simple code of conduct:

- **Be respectful** and inclusive
- **Be constructive** in feedback and discussions
- **Focus on the project** and technical issues
- **Help newcomers** learn and contribute

## Development Guidelines

### Project Structure

```
meteor-cloud-run/
├── src/                    # Source code
│   ├── index.js           # Main CLI entry point
│   ├── commands.js        # Command implementations
│   ├── utils.js           # Utility functions
│   ├── auth.js            # Authentication handling
│   ├── settings.js        # Settings processing
│   ├── fileGeneration.js  # File generation
│   ├── loadBalancer.js    # Load balancer setup
│   └── ...
├── docs/                  # Documentation
├── package.json           # Package configuration
├── README.md              # Main documentation
└── CONTRIBUTING.md        # This file
```

### Key Concepts

#### Service Accounts
The tool automatically configures Google Cloud service accounts with appropriate permissions. When modifying IAM-related code:
- Follow principle of least privilege
- Test with fresh Google Cloud projects
- Verify permissions work in organization environments

#### Resource Management
Resources are named consistently based on service names:
- Cloud Run service: `{service-name}`
- Static IP: `{service-name}-ip`
- SSL certificate: `{service-name}-ssl-cert`
- Secrets: `{service-name}-mongodb-url`

When adding new resources, follow this naming pattern.

#### Error Handling
- Provide helpful error messages
- Include suggestions for resolution
- Sanitize error messages to avoid exposing secrets
- Use consistent error formatting

#### Backward Compatibility
- Avoid breaking changes when possible
- Provide migration paths for configuration changes
- Support legacy file locations during transition periods
- Document any breaking changes clearly

## Getting Help

- **GitHub Issues**: For bugs and feature requests
- **GitHub Discussions**: For questions and general discussion
- **Documentation**: Check [docs/](docs/) for detailed guides

## Recognition

Contributors will be recognized in:
- Git commit history
- Release notes for significant contributions
- README.md contributors section (future)

Thank you for contributing to meteor-cloud-run! Your help makes this project better for everyone.