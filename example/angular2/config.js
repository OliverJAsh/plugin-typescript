System.config({
  baseURL: ".",
  defaultJSExtensions: true,
  transpiler: "traceur",
  typescriptOptions: {
    "noImplicitAny": false,
    "typeCheck": true,
    "resolveAmbientRefs": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true
  },
  paths: {
    "github:*": "jspm_packages/github/*",
    "npm:*": "jspm_packages/npm/*"
  },

  packages: {
    "src": {
      "main": "index",
      "defaultExtension": "ts",
      "meta": {
        "*.ts": {
          "loader": "ts"
        },
        "*.css": {
          "loader": "css"
        },
        "*.html": {
          "loader": "text"
        }
      }
    },
    "example-service": {
      "main": "index",
      "defaultExtension": "ts",
      "meta": {
        "*.ts": {
          "loader": "ts"
        }
      }
    }
  }
});
