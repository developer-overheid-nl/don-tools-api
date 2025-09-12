package services

import (
    "fmt"
    "os"
    "path/filepath"
    "strings"
    "time"
)

// PostmanService converteert OAS naar Postman Collections
type PostmanService struct{}

// NewPostmanService Constructor-functie
func NewPostmanService() *PostmanService {
	return &PostmanService{}
}

// ConvertOpenAPIToPostman converteert een OAS naar een Postman Collection JSON
// Retourneert de json-bytes en een standaard bestandsnaam.
func (s *PostmanService) ConvertOpenAPIToPostman(oas []byte) ([]byte, string, error) {
    if len(strings.TrimSpace(string(oas))) == 0 {
        return nil, "", ErrEmptyOAS
    }
    // Schrijf OAS naar tijdelijk bestand
    workDir, err := os.MkdirTemp("", "oas2postman-*")
	if err != nil {
		return nil, "", err
	}
	defer os.RemoveAll(workDir)

	ext := GuessExt(oas)
	inFile := filepath.Join(workDir, "openapi"+ext)
	if err := os.WriteFile(inFile, oas, 0o600); err != nil {
		return nil, "", err
	}

	outFile := filepath.Join(workDir, "collection.json")

	// Run: npx -y openapi-to-postmanv2 -s <inFile> -o <outFile>
	if _, _, err := ExecNPX(2*time.Minute, "openapi-to-postmanv2", "-s", inFile, "-o", outFile); err != nil {
		return nil, "", fmt.Errorf("%w", err)
	}

	b, err := os.ReadFile(outFile)
	if err != nil {
		return nil, "", err
	}

	name := "postman-collection"
	return b, name, nil
}
