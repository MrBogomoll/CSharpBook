import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


webroot = Path(__file__).resolve().parents[1] / "wwwroot"
course = json.loads((webroot / "course.json").read_text(encoding="utf-8"))
topics = {topic["id"]: topic for chapter in course for topic in chapter["topics"]}

csproj = """<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>
"""
projects = webroot / "projects"
projects.mkdir(exist_ok=True)

solution = """<Solution>
  <Project Path="ExpenseTracker/ExpenseTracker.csproj" />
  <Project Path="ExpenseTracker.Tests/ExpenseTracker.Tests.csproj" />
</Solution>
"""
tests_csproj = """<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="MSTest" Version="4.2.3" />
    <ProjectReference Include="../ExpenseTracker/ExpenseTracker.csproj" />
  </ItemGroup>
</Project>
"""
tests_cs = """using Microsoft.VisualStudio.TestTools.UnitTesting;

[assembly: Parallelize(Scope = ExecutionScope.MethodLevel)]

namespace ExpenseTracker.Tests;

[TestClass]
public sealed class LedgerTests
{
    [TestMethod]
    public void EmptyLedgerReturnsZero()
    {
        var ledger = new Ledger();

        Assert.AreEqual(0L, ledger.Total);
        Assert.AreEqual(0L, ledger.TotalFor("Спорт"));
    }

    [TestMethod]
    public void CategoryIgnoresCase()
    {
        var ledger = new Ledger();
        ledger.Add(120, "Еда");
        ledger.Add(80, "Транспорт");
        ledger.Add(30, "еда");

        Assert.AreEqual(230L, ledger.Total);
        Assert.AreEqual(150L, ledger.TotalFor("ЕДА"));
    }

    [TestMethod]
    public void TotalCanExceedIntRange()
    {
        var ledger = new Ledger();
        ledger.Add(int.MaxValue, "Еда");
        ledger.Add(10, "Еда");

        Assert.AreEqual(2147483657L, ledger.Total);
    }
}
"""


def archive_project(topic_id, example_number, include_tests=False):
    topic = topics[topic_id]
    example = topic["examples"][example_number]
    filename = PurePosixPath(topic["projectUrl"]).name
    stdin = example.get("stdin", [])
    commands = "\n".join(stdin)
    readme = """# Трекер расходов

1. Установи .NET 10 SDK.
2. Открой терминал в папке ExpenseTracker, в которой находится ExpenseTracker.csproj.
3. Выполни `dotnet run`.
"""
    if stdin:
        readme += "\nВведи эти команды по одной строке:\n\n```text\n" + commands + "\n```\n"
    readme += "\nОжидаемый вывод программы:\n\n```text\n" + example["output"] + "\n```\n"
    sources = {"ExpenseTracker.csproj": csproj, "Program.cs": example["code"], **example["files"]}
    if include_tests:
        readme += ("\nЧтобы запустить тесты, вернись на уровень выше командой `cd ..`,"
                   " затем выполни `dotnet test ExpenseTracker.slnx`. При первом запуске"
                   " SDK может загрузить пакеты MSTest из NuGet.\n")
    files = {f"ExpenseTracker/{name}": content for name, content in {**sources, "README.md": readme}.items()}
    if include_tests:
        files.update({
            "ExpenseTracker.slnx": solution,
            "ExpenseTracker.Tests/ExpenseTracker.Tests.csproj": tests_csproj,
            "ExpenseTracker.Tests/LedgerTests.cs": tests_cs
        })
    archive = projects / filename
    with ZipFile(archive, "w") as package:
        for name, data in files.items():
            if Path(name).is_absolute() or ".." in PurePosixPath(name).parts:
                raise ValueError(f"Invalid project member: {name}")
            entry = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            package.writestr(entry, data.rstrip() + "\n")

    sdks = subprocess.check_output(["dotnet", "--list-sdks"], encoding="utf-8").splitlines()
    sdk = next(re.match(r"(10\.\d+\.\d+) ", line).group(1)
               for line in reversed(sdks) if re.match(r"(10\.\d+\.\d+) ", line))
    with tempfile.TemporaryDirectory(prefix="CSharpBook-project-") as location:
        target = Path(location)
        (target / "global.json").write_text(json.dumps({"sdk": {"version": sdk}}), encoding="utf-8")
        with ZipFile(archive) as package:
            package.extractall(target)
        result = subprocess.run(
            ["dotnet", "run", "--project", "ExpenseTracker.csproj"],
            cwd=target / "ExpenseTracker",
            input=commands + "\n" if stdin else "",
            capture_output=True,
            encoding="utf-8",
            check=True,
            timeout=45
        )
        if result.stdout.rstrip("\n") != example["output"]:
            raise ValueError(f"Unexpected output from {archive.name}: {result.stdout!r}")
        print(f"{archive.name}: built and verified using SDK {sdk}")
        if include_tests:
            restarted = subprocess.run(
                ["dotnet", "run", "--no-build", "--project", "ExpenseTracker.csproj"],
                cwd=target / "ExpenseTracker",
                input="загрузить\nитог\nвыход\n",
                capture_output=True,
                encoding="utf-8",
                check=True,
                timeout=15
            )
            if restarted.stdout.strip().splitlines()[1:] != ["Загружено.", "Итого: 200 руб."]:
                raise ValueError(f"Unexpected output after restart: {restarted.stdout!r}")
            tests = subprocess.run(
                ["dotnet", "test", "ExpenseTracker.slnx"],
                cwd=target,
                capture_output=True,
                encoding="utf-8",
                timeout=55
            )
            if tests.returncode != 0:
                raise RuntimeError(tests.stdout + "\n" + tests.stderr)
            print("Archive round trip: restored 200 rubles after restart.")
            print(tests.stdout.rstrip().splitlines()[-1])


archive_project("split-project", 1)
archive_project("expense-capstone", 0, include_tests=True)
