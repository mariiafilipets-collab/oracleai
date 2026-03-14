# Добавить Claude Code в PATH (Windows)

Установщик поместил `claude.exe` в:
```
C:\Users\user\.local\bin
```
Чтобы вызывать `claude` из любого терминала, добавь эту папку в переменную PATH.

## Способ 1: через настройки системы

1. Нажми **Win + R**, введи `sysdm.cpl`, Enter.
2. Вкладка **Дополнительно** → **Переменные среды**.
3. В блоке «Переменные среды пользователя» выбери **Path** → **Измени**.
4. **Создать** → вставь: `C:\Users\user\.local\bin` → **ОК** везде.
5. Закрой и заново открой PowerShell/терминал.

## Способ 2: через PowerShell (текущая сессия + пользовательский PATH)

Выполни в PowerShell **один раз** (добавит путь в профиль пользователя):

```powershell
$path = [Environment]::GetEnvironmentVariable("Path", "User")
if ($path -notlike "*\.local\\bin*") {
  [Environment]::SetEnvironmentVariable("Path", "$path;C:\Users\user\.local\bin", "User")
  Write-Host "PATH updated. Restart the terminal and run: claude --help"
} else {
  Write-Host "Path already contains .local\bin"
}
```

После этого **перезапусти терминал** и проверь: `claude --help`.

## Проверка

В **новом** окне PowerShell:

```powershell
claude --version
```

Должно вывести версию (например 2.1.74).
