; Inno Setup script for Weighing System Windows installer.
; Requires PyInstaller output in ..\dist\WeighingSystem

#define MyAppName "Weighing System"
#define MyAppNameRu "Система учёта взвешиваний"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Weighing System"
#define MyAppExeName "WeighingSystem.exe"
#define BuildDir "..\dist\WeighingSystem"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppNameRu}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppNameRu}
DefaultGroupName={#MyAppNameRu}
DisableProgramGroupPage=yes
OutputDir=..\release
OutputBaseFilename=WeighingSystem-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; GroupDescription: "Дополнительно:"; Flags: unchecked

[Files]
Source: "{#BuildDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
Name: "{app}\BD"; Permissions: users-modify
Name: "{app}\logs"; Permissions: users-modify

[Icons]
Name: "{group}\{#MyAppNameRu}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#MyAppNameRu}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Запустить {#MyAppNameRu}"; Flags: nowait postinstall skipifsilent
