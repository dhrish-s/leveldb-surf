FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install all build tools in one layer
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    libsnappy-dev \
    python3 \
    python3-pip \
    vim \
    nano \
    gdb \
    valgrind \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Clone LevelDB with GoogleTest submodule
RUN git clone --recurse-submodules https://github.com/google/leveldb.git

# Clone SuRF filter library
RUN git clone https://github.com/efficient/SuRF.git

# Copy SuRF headers into LevelDB include tree
RUN mkdir -p /workspace/leveldb/include/surf && \
    cp -r /workspace/SuRF/include/* /workspace/leveldb/include/surf/

# COMBINED STEP: patch CMakeLists + create placeholder + build
# All in ONE RUN so nothing can be skipped or reordered
RUN cd /workspace/leveldb && \
    sed -i '/"util\/bloom.cc"/a\    "util\/surf_filter.cc"' CMakeLists.txt && \
    printf '// surf_filter.cc placeholder\n// This file will be replaced by rebuild.sh\n' > util/surf_filter.cc && \
    mkdir -p build && cd build && \
    cmake -DCMAKE_BUILD_TYPE=Release \
          -DLEVELDB_BUILD_TESTS=ON \
          -DLEVELDB_BUILD_BENCHMARKS=ON \
          .. && \
    cmake --build . --parallel 4

# Run all 154 baseline tests - must all pass
RUN /workspace/leveldb/build/leveldb_tests

# Create working folders
RUN mkdir -p /workspace/project /workspace/benchmarks

CMD ["/bin/bash"]
