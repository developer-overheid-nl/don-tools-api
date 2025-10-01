package services

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// ErrConverterUnavailable is returned when the underlying CLI isn't available
var ErrConverterUnavailable = errors.New("converter niet beschikbaar (npx/cli ontbreekt)")

// ErrEmptyOAS is returned when provided OpenAPI content is empty
var ErrEmptyOAS = errors.New("leeg OpenAPI document (geen inhoud)")

// GuessExt raadt de bestandsextensie (json of yaml) op basis van inhoud
func GuessExt(b []byte) string {
	s := strings.TrimSpace(string(b))
	if strings.HasPrefix(s, "{") {
		return ".json"
	}
	return ".yaml"
}

var filenameRe = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

// SanitizeFilename maakt een bestandsnaam veilig
func SanitizeFilename(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	name = strings.ToLower(name)
	name = filenameRe.ReplaceAllString(name, "-")
	name = strings.Trim(name, "-._")
	if name == "" {
		return ""
	}
	return name
}

// ZipDirectory pakt een directory in als ZIP en geeft bytes terug
func ZipDirectory(dir string) ([]byte, error) {
	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		w, err := zw.Create(rel)
		if err != nil {
			return err
		}
		if _, err := io.Copy(w, f); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		_ = zw.Close()
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ExecConverter probeert eerst een rechtstreeks geinstalleerde CLI te draaien en
// valt terug op npx wanneer de binary ontbreekt. Dit voorkomt dat npx telkens
// een npm-installatie uitvoert, wat veel tijd kost.
func ExecConverter(timeout time.Duration, bin string, args ...string) (string, string, error) {
	if path, err := exec.LookPath(bin); err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()

		cmd := exec.CommandContext(ctx, path, args...)
		var stdout, stderr bytes.Buffer
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr

		if err := cmd.Run(); err != nil {
			serr := strings.TrimSpace(stderr.String())
			if serr != "" {
				return stdout.String(), stderr.String(), fmt.Errorf("converter fout: %v: %s", err, serr)
			}
			return stdout.String(), stderr.String(), fmt.Errorf("converter fout: %v", err)
		}

		return stdout.String(), stderr.String(), nil
	}

	// Binary niet gevonden: val terug op npx voor lokale ontwikkelaars
	return ExecNPX(timeout, append([]string{bin}, args...)...)
}

// ExecNPX voert een npx-commando uit met timeout en geeft stdout/stderr terug
func ExecNPX(timeout time.Duration, args ...string) (string, string, error) {
	// Controleer of npx beschikbaar is
	if _, err := exec.LookPath("npx"); err != nil {
		return "", "", ErrConverterUnavailable
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	// Voeg -y toe zodat npx niet om bevestiging vraagt
	cmd := exec.CommandContext(ctx, "npx", append([]string{"-y"}, args...)...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		serr := strings.TrimSpace(stderr.String())
		if serr != "" {
			return stdout.String(), stderr.String(), fmt.Errorf("converter fout: %v: %s", err, serr)
		}
		return stdout.String(), stderr.String(), fmt.Errorf("converter fout: %v", err)
	}

	return stdout.String(), stderr.String(), nil
}
