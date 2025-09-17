package models

// Contact beschrijft contactinformatie bij een API bron of registratie
type Contact struct {
	Name  string `json:"name"`
	URL   string `json:"url"`
	Email string `json:"email"`
}

// ApiPost is de payload die naar het registratie endpoint wordt gepost
type ApiPost struct {
	Id              string  `json:"id,omitempty"`
	OasUrl          string  `json:"oasUrl" binding:"required,url"`
	OrganisationUri string  `json:"organisationUri" binding:"required,url"`
	Contact         Contact `json:"contact"`
}

// HarvestSource beschrijft een bron die geharvest moet worden
//   - IndexURL: URL van de index.json
//   - OrganisationUri: organisatie URI waaronder de APIs geregistreerd worden
//   - Contact: vaste contactgegevens voor deze bron
//   - UISuffix/OASPath: optioneel; bepaalt hoe van href → openapi.json wordt afgeleid
//     Standaard: UISuffix = "ui/", OASPath = "openapi.json"
type HarvestSource struct {
	Name            string  `json:"name,omitempty"`
	IndexURL        string  `json:"indexUrl"`
	OrganisationUri string  `json:"organisationUri"`
	Contact         Contact `json:"contact"`
	UISuffix        string  `json:"uiSuffix,omitempty"`
	OASPath         string  `json:"oasPath,omitempty"`
}
