package services

import (
    "archive/zip"
    "bytes"
    "context"
    "errors"
    "fmt"
    "io"
    "io/fs"
    "net/http"
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

// FetchURL haalt de inhoud op van een URL met een korte timeout
func FetchURL(rawURL string) ([]byte, error) {
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
    if err != nil {
        return nil, err
    }
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    if resp.StatusCode < 200 || resp.StatusCode >= 300 {
        return nil, fmt.Errorf("HTTP %d bij ophalen van URL", resp.StatusCode)
    }
    return io.ReadAll(resp.Body)
}

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
