{
  description = "Terax - open-source lightweight cross-platform AI-native terminal (ADE)";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }: let
    sources = builtins.fromJSON (builtins.readFile ./nix/sources.json);
    forAllSystems = nixpkgs.lib.genAttrs (builtins.attrNames sources.hashes);
  in {
    packages = forAllSystems (system: let
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      terax = pkgs.callPackage ./nix/package.nix { };
      default = self.packages.${system}.terax;
    });

    nixosModules.terax = { pkgs, ... }: {
      environment.systemPackages = [ self.packages.${pkgs.system}.terax ];
    };

    darwinModules.terax = { pkgs, ... }: {
      environment.systemPackages = [ self.packages.${pkgs.system}.terax ];
    };
  };
}
