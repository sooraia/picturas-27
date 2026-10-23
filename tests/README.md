# Tests

This directory contains [unit](/unit) and [integration](/integration) tests developed specifically for some of the functionalities implemented in the increment of the system centered around video editing support. 

To run the unit tests, you can run the following command without executing the application:
```bash
npm run test:unit
```

Even though the same is applied to a portion of the integration tests, you need the application to be running in order to execute all the integration tests:
```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 npm run test:integration
```

To execute all the tests:
```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 npm test
```