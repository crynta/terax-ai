FROM kalilinux/kali-rolling

RUN apt-get update && apt-get install -y \
    golang-go \
    git \
    python3-pip \
    nodejs \
    npm \
    curl \
    wget \
    nmap \
    netcat-openbsd \
    ffuf \
    gobuster \
    hydra \
    john \
    hashcat \
    sqlmap \
    metasploit-framework \
    seclists \
    exploitdb \
    hashid \
    bloodhound \
    neo4j \
    wkhtmltopdf \
    lftp \
    smbclient \
    enum4linux \
    crackmapexec \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g agent-browser && agent-browser install

RUN pip3 install mitmproxy --break-system-packages

RUN pip3 install pwntools impacket bloodhound --break-system-packages

RUN pip3 install pwncat-cs --break-system-packages

RUN go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest && \
    /root/go/bin/nuclei -update-templates -silent

RUN go install github.com/projectdiscovery/katana/cmd/katana@latest

ENV PATH="/root/go/bin:${PATH}"

WORKDIR /workspace
CMD ["/bin/bash"]
