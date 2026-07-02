{
  "targets": [
    {
      "target_name": "nexus_verify",
      "sources": [ "src/addon.c", "src/tweetnacl.c" ],
      "defines": [ "NAPI_VERSION=6" ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "RuntimeLibrary": 0
        }
      }
    }
  ]
}
