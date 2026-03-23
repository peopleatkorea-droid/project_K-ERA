#[derive(Debug, Serialize, Deserialize, Default, Clone, PartialEq, Eq)]
struct FederationSaltConfigFile {
    case_reference_salt: Option<String>,
    patient_reference_salt: Option<String>,
    public_alias_salt: Option<String>,
    source: Option<String>,
}

