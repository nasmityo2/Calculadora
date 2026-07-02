{
  "target_defaults": {
    "default_configuration": "Release",
    "msvs_settings": {
      "VCCLCompilerTool": {
        "ExceptionHandling": 1
      }
    }
  },
  "targets": [
    {
      "target_name": "nexus_verify",
      "sources": [ "src/addon.c" ],
      "defines": [ "NAPI_VERSION=6" ]
    }
  ]
}
