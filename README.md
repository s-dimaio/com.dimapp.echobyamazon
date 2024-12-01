# Echo by Amazon

This Homey Pro app allows you to control your Echo devices through your Homey smart home system.

## Features

- Control Echo devices from your Homey Pro
- Integrate Echo functionalities with your existing Homey automations
- Easy setup and configuration

## Supported Commands

- Adjust volume
- Voice command support

## Installation

To get started with Alexa by Echo, follow these steps:

1. Install the dependencies:
```sh
npm install
```

2. Start the app in Homey Pro:
```sh
homey app run
```


Note: Make sure you have Node.js and npm (Node Package Manager) installed on your system before proceeding with the installation.

## Usage

After installation, you can add your Echo devices to Homey:

1. Go to 'Devices' in the Homey app
2. Click the '+' button to add a new device
3. Select 'Echo by Amazon' from the list of apps
4. Follow the setup wizard to connect your Echo devices

### Amazon Domain
During the wizard you will have to choose which Amazon domain to use:

- North America (NA): used for amazon.com, amazon.ca, amazon.com.mx, amazon.com.br
- Europe (EU): used as default for most European countries
- Far East (FE): used for amazon.co.jp, amazon.com.au, amazon.com.in, amazon.co.nz

## Troubleshooting

If you encounter any issues:

1. Ensure your Echo devices are on the same network as your Homey Pro
2. Check that your Echo devices are updated to the latest firmware
3. Restart both your Homey Pro and Echo devices

### "Page not found" error when trying to connect to Amazon account
If you have Multi-Factor Authentication (MFA) turned on for your Amazon account, you might see a "page not found" error when connecting the app. To resolve this issue:
- Log into your Amazon account via a web browser
- Enable two-factor authentication
- Use an authenticator app such as Google Authenticator
- Use the code generated by the authenticator app, not the one Amazon texts to you

This solution should resolve the connection problem.

### Unstable connection and long response times
If when you update an Echo device the Homey app does not update or updates with a very long delay, try creating a new connection by changing the Amazon domain

For further assistance, please open an issue on our GitHub repository.

## Contributing

We welcome contributions to improve this app! Please feel free to submit pull requests or open issues for any bugs or feature requests but please read our [Code of Conduct](CODE_OF_CONDUCT.md) and [Contributing Guidelines](CONTRIBUTING.md) before submitting.

## Disclaimer

ECHO is a trademark of Amazon.com, Inc. or its affiliates. This project is not in any way affiliated with, sponsored by, or endorsed by Amazon. It is an independent and unofficial app developed to enhance the functionality of Homey Pro with Echo devices.

## License

This project is released under the GNU License. For full details, please see the [LICENSE](LICENSE) file.