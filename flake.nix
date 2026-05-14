{
  description = "Terax - open-source lightweight cross-platform AI-native terminal (ADE)";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }: let
    forAllSystems = nixpkgs.lib.genAttrs [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
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
