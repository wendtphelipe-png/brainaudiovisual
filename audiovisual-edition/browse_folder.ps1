param(
    [string]$InitialPath = ""
)

try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.Application]::EnableVisualStyles()

    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Brain Audiovisual - Selecione a pasta de destino para salvar os vídeos'
    $dialog.ShowNewFolderButton = $true

    if ($InitialPath -and (Test-Path $InitialPath)) {
        $dialog.SelectedPath = $InitialPath
    } else {
        $defaultDownloads = Join-Path $env:USERPROFILE "Downloads"
        if (Test-Path $defaultDownloads) {
            $dialog.SelectedPath = $defaultDownloads
        }
    }

    $form = New-Object System.Windows.Forms.Form
    $form.TopMost = $true
    $form.StartPosition = 'CenterScreen'
    $form.Width = 0
    $form.Height = 0
    $form.FormBorderStyle = 'None'
    $form.ShowInTaskbar = $false
    $form.Show()
    $form.BringToFront()
    $form.Activate()

    $result = $dialog.ShowDialog($form)

    if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        [Console]::WriteLine($dialog.SelectedPath)
    }

    $form.Close()
    $form.Dispose()
    $dialog.Dispose()
} catch {
    # Silencioso
}
