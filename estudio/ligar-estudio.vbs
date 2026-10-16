' Liga o Estudio de dublagem v2 sem abrir janela preta.
' Se ele ja estiver ligado, nao faz nada (o servidor percebe a porta ocupada e sai).
' O registro do servidor fica em estudio\dados\servidor.log.
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
raiz = fso.GetParentFolderName(pasta)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = raiz
sh.Run "cmd /c node estudio\server.js >> estudio\dados\servidor.log 2>&1", 0, False
