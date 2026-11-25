internal static class GoogleClientDialog
{
    internal static GoogleDesktopRegistration Ask(IWin32Window owner, string clientId)
    {
        using var dialog = new Form
        {
            Text = "Подключить Google Диск", StartPosition = FormStartPosition.CenterParent,
            FormBorderStyle = FormBorderStyle.FixedDialog, MinimizeBox = false, MaximizeBox = false,
            AutoScaleMode = AutoScaleMode.Dpi, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink,
            ShowInTaskbar = false
        };
        var layout = new TableLayoutPanel { AutoSize = true, Padding = new Padding(14), ColumnCount = 1, Dock = DockStyle.Fill };
        dialog.Controls.Add(layout);
        var instructions = new Label
        {
            AutoSize = true, MaximumSize = new Size(420, 0),
            Text = "На этом ПК один раз нужен ключ приложения. Вставь Client secret клиента Sharpwise Windows из Google Cloud или открой сохранённый JSON этого клиента."
        };
        layout.Controls.Add(instructions);
        var label = new Label { Text = "Client secret", AutoSize = true, Margin = new Padding(3, 12, 3, 0) };
        layout.Controls.Add(label);
        var secret = new TextBox { UseSystemPasswordChar = true, MaxLength = 4096, Dock = DockStyle.Fill, AccessibleName = label.Text };
        layout.Controls.Add(secret);
        var buttons = new FlowLayoutPanel { AutoSize = true, WrapContents = false };
        var browse = new Button { Text = "Открыть JSON…", AutoSize = true };
        var next = new Button { Text = "Продолжить", AutoSize = true, Enabled = false, DialogResult = DialogResult.OK };
        var cancel = new Button { Text = "Отмена", AutoSize = true, DialogResult = DialogResult.Cancel };
        buttons.Controls.AddRange([browse, next, cancel]);
        layout.Controls.Add(buttons);
        dialog.AcceptButton = next;
        dialog.CancelButton = cancel;
        secret.TextChanged += (_, _) => next.Enabled = !string.IsNullOrWhiteSpace(secret.Text);
        dialog.Shown += (_, _) => secret.Focus();
        GoogleDesktopRegistration? imported = null;
        browse.Click += (_, _) =>
        {
            using var picker = new OpenFileDialog { Title = "Выбери JSON клиента Sharpwise Windows", Filter = "Клиент Google (*.json)|*.json" };
            if (picker.ShowDialog(dialog) != DialogResult.OK) return;
            try
            {
                using var file = File.OpenRead(picker.FileName);
                imported = GoogleDesktopRegistration.Import(file, clientId);
                dialog.DialogResult = DialogResult.OK;
            }
            catch (Exception e) when (e is InvalidDataException or IOException or UnauthorizedAccessException)
            {
                string message = e is InvalidDataException ? e.Message : "Не удалось открыть выбранный файл.";
                MessageBox.Show(dialog, message, dialog.Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        };
        if (dialog.ShowDialog(owner) != DialogResult.OK)
            throw new InvalidOperationException("Подключение Google Диска отменено. Прогресс сохранён на устройстве.");
        return imported ?? GoogleDesktopRegistration.FromSecret(clientId, secret.Text);
    }
}
